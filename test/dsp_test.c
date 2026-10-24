/* Native test: cc -Isrc/dsp test/dsp_test.c -ldl -o <out> && <out> */
#include <assert.h>
#include <stdio.h>

static double g_now;
#define CD_NOW_MS() g_now
#include "../src/dsp/chord_display.c"

static int g_recv = 2;                      /* what the fake slot says: channel byte, so 2 = ch 3 */
static int fake_recv(void *ctx) { (void)ctx; return g_recv; }

static void midi(void *c, uint8_t st, uint8_t note, uint8_t vel, int source)
{
    uint8_t m[3] = { st, note, vel };
    cd_on_midi(c, m, 3, source);
}
static void on(void *c, int ch, int note)  { midi(c, (uint8_t)(0x90 | (ch - 1)), (uint8_t)note, 100, MOVE_MIDI_SOURCE_FX_BROADCAST); }
static void off(void *c, int ch, int note) { midi(c, (uint8_t)(0x80 | (ch - 1)), (uint8_t)note, 0, MOVE_MIDI_SOURCE_FX_BROADCAST); }

static int head_is(void *c, const char *want)
{
    char buf[64];
    cd_get_param(c, "chord_notes", buf, sizeof buf);
    size_t n = strlen(want);
    return strncmp(buf, want, n) == 0 && buf[n] == '|';
}

static void chord(void *c, int ch, int a, int b, int d)
{
    on(c, ch, a); g_now += 8; on(c, ch, b); g_now += 8; on(c, ch, d);
    g_now += 40;                              /* past the settle window */
}

int main(void)
{
    host_api_v1_t host;
    memset(&host, 0, sizeof host);
    host.slot_recv_channel = fake_recv;
    host.mod_host_ctx = &host;
    audio_fx_api_v2_t *api = move_audio_fx_init_v2(&host);
    assert(api && api->api_version == 2 && api->create_instance && api->process_block && api->get_param);

    void *c = api->create_instance(NULL, NULL);
    char buf[256];
    assert(head_is(c, ""));

    /* Auto = the slot's own channel (3). Channel 2 is ignored, channel 3 counts. */
    chord(c, 2, 60, 64, 67);
    assert(head_is(c, ""));
    chord(c, 3, 48, 52, 55);
    assert(head_is(c, "48,52,55"));
    off(c, 3, 48); off(c, 3, 52); off(c, 3, 55);

    /* only the broadcast feed counts: the slot's own MIDI FX output is the same note again */
    midi(c, 0x92, 70, 100, MOVE_MIDI_SOURCE_INTERNAL); g_now += 40;
    midi(c, 0x92, 70, 100, MOVE_MIDI_SOURCE_EXTERNAL); g_now += 40;
    assert(head_is(c, "48,52,55"));

    /* the settle window: still open right after the last press, closed after */
    on(c, 3, 50); on(c, 3, 53); on(c, 3, 57);
    assert(head_is(c, "48,52,55"));
    g_now += 30;
    assert(head_is(c, "50,53,57"));

    /* releasing one by one, or all, keeps the chord for as long as it takes */
    off(c, 3, 57); off(c, 3, 53); off(c, 3, 50); g_now += 60000;
    assert(head_is(c, "50,53,57"));

    /* a tap shorter than the settle window still replaces it, as a single note */
    on(c, 3, 72); g_now += 5; off(c, 3, 72); g_now += 40;
    assert(head_is(c, "72"));

    /* an explicit channel, and Omni */
    cd_set_param(c, "channel", "2");
    chord(c, 3, 60, 64, 67);
    assert(head_is(c, "72"));
    off(c, 3, 60); off(c, 3, 64); off(c, 3, 67);
    chord(c, 2, 62, 65, 69);
    assert(head_is(c, "62,65,69"));
    off(c, 2, 62); off(c, 2, 65); off(c, 2, 69);
    cd_get_param(c, "channel", buf, sizeof buf); assert(strcmp(buf, "2") == 0);
    cd_set_param(c, "channel", "Omni");
    chord(c, 9, 43, 47, 50);
    assert(head_is(c, "43,47,50"));
    off(c, 9, 43); off(c, 9, 47); off(c, 9, 50);

    /* Auto on a slot that listens to All behaves as Omni; an unknown slot too */
    cd_set_param(c, "channel", "Auto");
    g_recv = -1;
    chord(c, 5, 41, 45, 48);
    assert(head_is(c, "41,45,48"));
    off(c, 5, 41); off(c, 5, 45); off(c, 5, 48);
    g_recv = -2;
    chord(c, 6, 40, 44, 47);
    assert(head_is(c, "40,44,47"));

    /* state round trip, text and index spellings */
    cd_set_param(c, "channel", "17");
    cd_get_param(c, "channel", buf, sizeof buf); assert(strcmp(buf, "Auto") == 0);
    cd_set_param(c, "channel", "5");
    cd_get_param(c, "state", buf, sizeof buf); assert(strcmp(buf, "{\"channel\":\"5\"}") == 0);
    cd_set_param(c, "state", "{\"channel\":\"Auto\"}");
    cd_get_param(c, "channel", buf, sizeof buf); assert(strcmp(buf, "Auto") == 0);
    cd_set_param(c, "state", "{\"channel\":\"12\"}");
    cd_get_param(c, "channel", buf, sizeof buf); assert(strcmp(buf, "12") == 0);

    /* all notes off forgets stuck notes; other messages are ignored without harm */
    cd_set_param(c, "channel", "Omni");
    on(c, 1, 60); on(c, 1, 64);
    { uint8_t m[3] = { 0xB0, 123, 0 }; cd_on_midi(c, m, 3, MOVE_MIDI_SOURCE_FX_BROADCAST); }
    { uint8_t m[3] = { 0xE0, 1, 64 }; cd_on_midi(c, m, 3, MOVE_MIDI_SOURCE_FX_BROADCAST); }
    { uint8_t m[1] = { 0xF8 }; cd_on_midi(c, m, 1, MOVE_MIDI_SOURCE_FX_BROADCAST); }
    assert(((chord_t *)c)->nheld == 0);

    /* audio is left untouched */
    { int16_t a[8] = { 1, -2, 3, -4, 5, -6, 7, -8 }, b[8]; memcpy(b, a, sizeof a);
      api->process_block(c, a, 4); assert(memcmp(a, b, sizeof a) == 0); }

    /* metadata and key are readable; a too-small buffer is refused, not overrun */
    assert(cd_get_param(c, "chain_params", buf, 16) < 0);
    { char big[1024]; assert(cd_get_param(c, "chain_params", big, sizeof big) > 0); }
    assert(cd_get_param(c, "key", buf, sizeof buf) > 0 && strncmp(buf, "-1|", 3) == 0);

    api->destroy_instance(c);
    puts("dsp ok");
    return 0;
}
