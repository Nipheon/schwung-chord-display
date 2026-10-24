/*
 * Chord Display: a MIDI FX that watches the notes going through its slot and
 * publishes the chord being held. It passes every message through unchanged.
 *
 * The DSP only tracks notes and time. Naming the chord and the roman numeral
 * are canvas.js's job; this side publishes:
 *   chord_notes  "<n>,<n>,..|<gen>"  the latched chord (MIDI notes, ascending)
 *   key          "<root>|<scale>"    Move's root note (0-11, -1 unknown) and scale
 *
 * Latching: a note-on opens a short settle window so pad presses that are not
 * perfectly simultaneous count as one chord. When it closes, the chord is
 * whatever is held (plus notes tapped inside the window). Releasing notes one
 * by one does not change it. When the last note is up, it stays for Hold ms;
 * any new note-on cancels that.
 *
 * REALTIME: process_midi() and tick() run on the SPI callback. Nothing here
 * allocates, logs or opens a file.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include "midi_fx_api_v1.h"
#include "move_info.h"

#define SETTLE_MS 25.0
#define HOLD_DEFAULT 1000
#define HOLD_MAX 5000

typedef struct {
    uint8_t held[128];
    uint8_t window[128];    /* pressed since the last latch */
    uint8_t latched[128];
    int nheld;
    int n_latched;
    uint32_t gen;           /* bumps whenever the latched chord changes */
    int hold_ms;
    double now_ms;
    double settle_at;       /* < 0 = no window open */
    double clear_at;        /* < 0 = no Hold running */
} chord_t;

static void *cd_create(const char *module_dir, const char *config_json)
{
    (void)module_dir; (void)config_json;
    chord_t *c = (chord_t *)calloc(1, sizeof(chord_t));
    if (!c) return NULL;
    c->hold_ms = HOLD_DEFAULT;
    c->settle_at = -1;
    c->clear_at = -1;
    /* The first read may open a file; keep that out of the realtime path. */
    move_info_t mi;
    move_info_read(&mi);
    return c;
}

static void cd_destroy(void *instance)
{
    free(instance);
}

static void clear_latched(chord_t *c)
{
    if (c->n_latched == 0) return;
    memset(c->latched, 0, sizeof c->latched);
    c->n_latched = 0;
    c->gen++;
}

static void latch(chord_t *c)
{
    int n = 0;
    for (int i = 0; i < 128; i++) {
        c->latched[i] = (uint8_t)(c->held[i] || c->window[i]);
        n += c->latched[i];
    }
    memset(c->window, 0, sizeof c->window);
    c->n_latched = n;
    c->gen++;
}

static void note_on(chord_t *c, int note)
{
    if (!c->held[note]) { c->held[note] = 1; c->nheld++; }
    c->window[note] = 1;
    c->settle_at = c->now_ms + SETTLE_MS;
    c->clear_at = -1;
}

static void note_off(chord_t *c, int note)
{
    if (c->held[note]) { c->held[note] = 0; c->nheld--; }
    if (c->nheld > 0 || c->settle_at >= 0) return;   /* a window still decides */
    if (c->hold_ms <= 0) clear_latched(c);
    else c->clear_at = c->now_ms + c->hold_ms;
}

static int cd_process_midi(void *instance,
                           const uint8_t *in_msg, int in_len,
                           uint8_t out_msgs[][3], int out_lens[],
                           int max_out)
{
    chord_t *c = (chord_t *)instance;
    if (!c || !in_msg || in_len < 1) return 0;

    uint8_t st = in_msg[0] & 0xF0;
    if (in_len >= 3 && st == 0x90 && in_msg[2] > 0) note_on(c, in_msg[1] & 0x7F);
    else if (in_len >= 3 && (st == 0x80 || st == 0x90)) note_off(c, in_msg[1] & 0x7F);
    else if (in_len >= 3 && st == 0xB0 && (in_msg[1] == 123 || in_msg[1] == 120)) {
        memset(c->held, 0, sizeof c->held);     /* all notes off: forget stuck notes */
        c->nheld = 0;
        if (c->settle_at < 0) note_off(c, 0);
    }

    /* Pass everything through unchanged. */
    if (max_out >= 1 && in_len <= 3) {
        for (int i = 0; i < in_len; i++) out_msgs[0][i] = in_msg[i];
        out_lens[0] = in_len;
        return 1;
    }
    return 0;
}

static int cd_tick(void *instance, int frames, int sample_rate,
                   uint8_t out_msgs[][3], int out_lens[], int max_out)
{
    (void)out_msgs; (void)out_lens; (void)max_out;
    chord_t *c = (chord_t *)instance;
    if (!c || sample_rate <= 0) return 0;
    c->now_ms += 1000.0 * frames / sample_rate;

    if (c->settle_at >= 0 && c->now_ms >= c->settle_at) {
        latch(c);
        c->settle_at = -1;
        if (c->nheld == 0) {
            if (c->hold_ms <= 0) clear_latched(c);
            else c->clear_at = c->now_ms + c->hold_ms;
        }
    }
    if (c->clear_at >= 0 && c->now_ms >= c->clear_at) {
        clear_latched(c);
        c->clear_at = -1;
    }
    return 0;
}

static void cd_set_param(void *instance, const char *key, const char *val)
{
    chord_t *c = (chord_t *)instance;
    if (!c || !key || !val) return;
    if (strcmp(key, "hold") == 0) {
        int v = atoi(val);
        c->hold_ms = v < 0 ? 0 : v > HOLD_MAX ? HOLD_MAX : v;
    } else if (strcmp(key, "state") == 0) {
        const char *p = strstr(val, "\"hold\"");
        if (p && (p = strchr(p, ':'))) {
            int v = atoi(p + 1);
            c->hold_ms = v < 0 ? 0 : v > HOLD_MAX ? HOLD_MAX : v;
        }
    }
}

static const char CHAIN_PARAMS_JSON[] =
    "["
    "{\"key\":\"hold\",\"name\":\"Hold\",\"type\":\"int\",\"min\":0,\"max\":5000,\"step\":50,\"default\":1000,\"unit\":\"ms\"},"
    "{\"key\":\"chord_notes\",\"name\":\"Chord\",\"type\":\"string\",\"access\":\"read\"},"
    "{\"key\":\"key\",\"name\":\"Key\",\"type\":\"string\",\"access\":\"read\"}"
    "]";

static int cd_get_param(void *instance, const char *key, char *buf, int buf_len)
{
    chord_t *c = (chord_t *)instance;
    if (!c || !key || !buf || buf_len < 2) return -1;

    if (strcmp(key, "hold") == 0) return snprintf(buf, buf_len, "%d", c->hold_ms);

    if (strcmp(key, "chord_notes") == 0) {
        int pos = 0;
        for (int i = 0; i < 128 && pos < buf_len - 1; i++) {
            if (!c->latched[i]) continue;
            pos += snprintf(buf + pos, buf_len - pos, "%s%d", pos ? "," : "", i);
        }
        if (pos >= buf_len) return -1;
        int n = snprintf(buf + pos, buf_len - pos, "|%u", (unsigned)c->gen);
        return n < 0 || pos + n >= buf_len ? -1 : pos + n;
    }

    if (strcmp(key, "key") == 0) {
        move_info_t mi;
        int root = -1;
        char scale[sizeof mi.scale + 1] = "";
        if (move_info_read(&mi) && mi.valid) {
            root = mi.root_note;
            memcpy(scale, mi.scale, sizeof mi.scale);
            scale[sizeof mi.scale] = '\0';
        }
        return snprintf(buf, buf_len, "%d|%s", root, scale);
    }

    if (strcmp(key, "state") == 0) return snprintf(buf, buf_len, "{\"hold\":%d}", c->hold_ms);

    if (strcmp(key, "chain_params") == 0) {
        int n = (int)strlen(CHAIN_PARAMS_JSON);
        if (n >= buf_len) return -1;
        memcpy(buf, CHAIN_PARAMS_JSON, (size_t)n + 1);
        return n;
    }
    return -1;
}

static midi_fx_api_v1_t g_api = {
    .api_version      = MIDI_FX_API_VERSION,
    .create_instance  = cd_create,
    .destroy_instance = cd_destroy,
    .process_midi     = cd_process_midi,
    .tick             = cd_tick,
    .set_param        = cd_set_param,
    .get_param        = cd_get_param,
};

midi_fx_api_v1_t *move_midi_fx_init(const struct host_api_v1 *host)
{
    (void)host;
    return &g_api;
}
