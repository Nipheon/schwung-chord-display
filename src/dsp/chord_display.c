/*
 * Chord Display: an audio FX that watches the MIDI of every channel and
 * publishes the chord being held. It leaves the audio untouched and never
 * touches MIDI, so the slot's synth plays exactly what it would without it.
 *
 * Why an audio FX: the chain host hands audio FX every note on every channel
 * (MOVE_MIDI_SOURCE_FX_BROADCAST, original channel byte), while a MIDI FX only
 * ever sees its own slot's filtered stream. That lets the module sit on the bass
 * track and read the chords of another one.
 *
 * Published for canvas.js (which names the chord and draws it):
 *   chord_notes  "<n>,<n>,..|<gen>"  the latched chord (MIDI notes, ascending)
 *   key          "<root>|<scale>"    Move's root note (0-11, -1 unknown) and scale
 *
 * Latching: a note-on opens a short settle window so pad presses that are not
 * perfectly simultaneous count as one chord. When it closes, the chord is
 * whatever is held (plus notes tapped inside the window). Releasing notes one
 * by one does not change it; the chord stays until the next one.
 *
 * Time comes from the wall clock, not from process_block: an idle slot does not
 * render its audio FX, and the window must still close.
 *
 * Channel: Auto (the slot's own receive channel; Omni when it listens to All),
 * Omni, or 1-16.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <time.h>

#include "audio_fx_api_v2.h"
#include "move_info.h"

#define SETTLE_MS 25.0

#define CH_OMNI 0
#define CH_AUTO 17      /* option index after Omni, 1-16 */

typedef struct {
    uint8_t held[128];
    uint8_t window[128];    /* pressed since the last latch */
    uint8_t latched[128];
    int nheld;
    uint32_t gen;           /* bumps whenever the latched chord changes */
    int channel;            /* CH_OMNI, 1-16, or CH_AUTO */
    double settle_at;       /* < 0 = no window open */
    int (*slot_recv_channel)(void *);
    void *host_ctx;
} chord_t;

static const host_api_v1_t *g_host = NULL;

/* Replaced by tests, which need a clock they can move. */
#ifndef CD_NOW_MS
static double now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}
#define CD_NOW_MS now_ms
#endif

static void *cd_create(const char *module_dir, const char *config_json)
{
    (void)module_dir; (void)config_json;
    chord_t *c = (chord_t *)calloc(1, sizeof(chord_t));
    if (!c) return NULL;
    c->channel = CH_AUTO;
    c->settle_at = -1;
    if (g_host) {
        /* Each slot's init hands over its own host api and create_instance runs
         * right after it, so this is the owning slot's context. */
        c->slot_recv_channel = g_host->slot_recv_channel;
        c->host_ctx = g_host->mod_host_ctx;
    }
    /* The first read may open a file; keep that out of the realtime path. */
    move_info_t mi;
    move_info_read(&mi);
    return c;
}

static void cd_destroy(void *instance)
{
    free(instance);
}

static void latch(chord_t *c)
{
    for (int i = 0; i < 128; i++) c->latched[i] = (uint8_t)(c->held[i] || c->window[i]);
    memset(c->window, 0, sizeof c->window);
    c->gen++;
}

/* Close the settle window once it is due. Called from on_midi and get_param. */
static void settle_if_due(chord_t *c)
{
    if (c->settle_at >= 0 && CD_NOW_MS() >= c->settle_at) {
        latch(c);
        c->settle_at = -1;
    }
}

/* The channel to listen to, 1-16, or 0 for all. */
static int listen_channel(chord_t *c)
{
    if (c->channel != CH_AUTO) return c->channel;
    if (c->slot_recv_channel) {
        int r = c->slot_recv_channel(c->host_ctx);     /* -1 All, 0-15, -2 unknown */
        if (r >= 0 && r <= 15) return r + 1;
    }
    return CH_OMNI;
}

static void cd_on_midi(void *instance, const uint8_t *msg, int len, int source)
{
    chord_t *c = (chord_t *)instance;
    if (!c || !msg || len < 3) return;
    /* The same note also reaches an audio FX as the slot's own MIDI FX output;
     * count only the broadcast, which carries every channel exactly once. */
    if (source != MOVE_MIDI_SOURCE_FX_BROADCAST) return;

    uint8_t st = msg[0] & 0xF0;
    if (st != 0x90 && st != 0x80 && st != 0xB0) return;
    int want = listen_channel(c);
    if (want != CH_OMNI && (msg[0] & 0x0F) != want - 1) return;

    settle_if_due(c);
    if (st == 0x90 && msg[2] > 0) {
        int note = msg[1] & 0x7F;
        if (!c->held[note]) { c->held[note] = 1; c->nheld++; }
        c->window[note] = 1;
        c->settle_at = CD_NOW_MS() + SETTLE_MS;
    } else if (st == 0x80 || st == 0x90) {
        int note = msg[1] & 0x7F;
        if (c->held[note]) { c->held[note] = 0; c->nheld--; }
    } else if (msg[1] == 123 || msg[1] == 120) {
        memset(c->held, 0, sizeof c->held);     /* all notes off: forget stuck notes */
        c->nheld = 0;
    }
}

static void cd_process_block(void *instance, int16_t *audio_inout, int frames)
{
    (void)instance; (void)audio_inout; (void)frames;     /* audio is left untouched */
}

static int parse_channel(const char *val)
{
    if (strcmp(val, "Auto") == 0) return CH_AUTO;
    if (strcmp(val, "Omni") == 0) return CH_OMNI;
    int ch = atoi(val);
    if (ch >= 1 && ch <= 16) return ch;
    return ch == CH_AUTO ? CH_AUTO : CH_OMNI;
}

static void cd_set_param(void *instance, const char *key, const char *val)
{
    chord_t *c = (chord_t *)instance;
    if (!c || !key || !val) return;
    if (strcmp(key, "channel") == 0) {
        c->channel = parse_channel(val);
    } else if (strcmp(key, "state") == 0) {
        const char *p = strstr(val, "\"channel\"");
        if (p && (p = strchr(p, ':'))) {
            char tok[8];
            size_t n = 0;
            while (*++p == ' ' || *p == '"') {}
            while (n < sizeof tok - 1 && ((*p >= '0' && *p <= '9') || (*p >= 'A' && *p <= 'z'))) tok[n++] = *p++;
            tok[n] = '\0';
            c->channel = parse_channel(tok);
        }
    }
}

static const char *channel_name(int ch, char *tmp, size_t n)
{
    if (ch == CH_AUTO) return "Auto";
    if (ch == CH_OMNI) return "Omni";
    snprintf(tmp, n, "%d", ch);
    return tmp;
}

/* The host plans its pages from this, not from module.json: the chord page has
 * to be declared here too, or it shows up as a plain cell. */
static const char CHAIN_PARAMS_JSON[] =
    "["
    "{\"key\":\"face\",\"name\":\"Chord\",\"type\":\"canvas\",\"canvas_script\":\"canvas.js\",\"as_page\":true,\"page_first\":true,\"show_value\":false,\"extra_keys\":[\"chord_notes\",\"key\"]},"
    "{\"key\":\"channel\",\"name\":\"Channel\",\"type\":\"enum\",\"options\":[\"Omni\",\"1\",\"2\",\"3\",\"4\",\"5\",\"6\",\"7\",\"8\",\"9\",\"10\",\"11\",\"12\",\"13\",\"14\",\"15\",\"16\",\"Auto\"],\"default\":\"Auto\"},"
    "{\"key\":\"chord_notes\",\"name\":\"Notes\",\"type\":\"string\",\"access\":\"read\"},"
    "{\"key\":\"key\",\"name\":\"Key\",\"type\":\"string\",\"access\":\"read\"}"
    "]";

static int cd_get_param(void *instance, const char *key, char *buf, int buf_len)
{
    chord_t *c = (chord_t *)instance;
    if (!c || !key || !buf || buf_len < 2) return -1;
    char tmp[8];

    if (strcmp(key, "channel") == 0) return snprintf(buf, buf_len, "%s", channel_name(c->channel, tmp, sizeof tmp));

    if (strcmp(key, "chord_notes") == 0) {
        settle_if_due(c);
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

    if (strcmp(key, "state") == 0) return snprintf(buf, buf_len, "{\"channel\":\"%s\"}", channel_name(c->channel, tmp, sizeof tmp));

    if (strcmp(key, "chain_params") == 0) {
        int n = (int)strlen(CHAIN_PARAMS_JSON);
        if (n >= buf_len) return -1;
        memcpy(buf, CHAIN_PARAMS_JSON, (size_t)n + 1);
        return n;
    }
    return -1;
}

/* --- API exports, in the shape Ducker uses --- */

static audio_fx_api_v2_t g_fx_api_v2;

audio_fx_api_v2_t *move_audio_fx_init_v2(const host_api_v1_t *host)
{
    g_host = host;
    memset(&g_fx_api_v2, 0, sizeof g_fx_api_v2);
    g_fx_api_v2.api_version = AUDIO_FX_API_VERSION_2;
    g_fx_api_v2.create_instance = cd_create;
    g_fx_api_v2.destroy_instance = cd_destroy;
    g_fx_api_v2.process_block = cd_process_block;
    g_fx_api_v2.set_param = cd_set_param;
    g_fx_api_v2.get_param = cd_get_param;
    /* on_midi is NOT in the struct (ABI safety for old hosts): the chain host
     * finds it through the standalone symbol below. */
    return &g_fx_api_v2;
}

void move_audio_fx_on_midi(void *instance, const uint8_t *msg, int len, int source)
{
    cd_on_midi(instance, msg, len, source);
}
