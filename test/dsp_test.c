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
    cd_get_param(c, "listen", buf, sizeof buf); assert(strcmp(buf, "3") == 0);
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
    cd_get_param(c, "listen", buf, sizeof buf); assert(strcmp(buf, "2") == 0);
    cd_set_param(c, "channel", "Omni");
    cd_get_param(c, "listen", buf, sizeof buf); assert(strcmp(buf, "0") == 0);
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

    api->destroy_instance(c);

    /* ---- a fresh instance, Auto on a slot that listens to channel 3 ---- */
    g_recv = 2;
    void *d = api->create_instance(NULL, NULL);
    chord_t *ds = (chord_t *)d;

    /* a chord built note by note, more than the settle window apart, grows */
    on(d, 3, 60); g_now += 100; assert(head_is(d, "60"));
    on(d, 3, 64); g_now += 100; assert(head_is(d, "60,64"));
    on(d, 3, 67); g_now += 100; assert(head_is(d, "60,64,67"));

    /* legato: a new chord of its own replaces the one still held, it is not merged */
    on(d, 3, 65); g_now += 8; on(d, 3, 69); g_now += 8; on(d, 3, 72); g_now += 40;
    assert(head_is(d, "65,69,72"));
    /* the old notes are forgotten, so releasing them changes nothing */
    off(d, 3, 60); off(d, 3, 64); off(d, 3, 67);
    assert(ds->nheld == 3 && head_is(d, "65,69,72"));
    /* a single note over the held chord adds to it */
    on(d, 3, 77); g_now += 40; assert(head_is(d, "65,69,72,77"));
    off(d, 3, 65); off(d, 3, 69); off(d, 3, 72); off(d, 3, 77);
    assert(ds->nheld == 0);

    /* changing the channel mid-chord must not leave stuck notes */
    cd_set_param(d, "channel", "Auto");
    chord(d, 3, 48, 52, 55); assert(head_is(d, "48,52,55"));
    cd_set_param(d, "channel", "5");
    off(d, 3, 48); off(d, 3, 52); off(d, 3, 55);           /* filtered out: channel 3 is no longer read */
    assert(ds->nheld == 0);
    chord(d, 5, 62, 65, 69); assert(head_is(d, "62,65,69"));
    off(d, 5, 62); off(d, 5, 65); off(d, 5, 69);

    /* the same for Auto following the slot to another channel */
    cd_set_param(d, "channel", "Auto");
    g_recv = 2;
    on(d, 3, 60); g_now += 40;                              /* held on channel 3 */
    g_recv = 3;                                             /* the slot now listens to channel 4 */
    cd_get_param(d, "listen", buf, sizeof buf); assert(strcmp(buf, "4") == 0);
    assert(ds->nheld == 0);
    off(d, 3, 60);
    chord(d, 4, 50, 53, 57); assert(head_is(d, "50,53,57"));
    off(d, 4, 50); off(d, 4, 53); off(d, 4, 57);
    g_recv = 2;

    /* Omni keeps the same note number on two channels apart */
    cd_set_param(d, "channel", "Omni");
    on(d, 1, 60); on(d, 2, 60); assert(ds->nheld == 2);
    off(d, 1, 60); assert(ds->nheld == 1);
    off(d, 2, 60); assert(ds->nheld == 0);

    /* velocity-0 note-on is a release */
    on(d, 1, 61); assert(ds->nheld == 1);
    midi(d, 0x90, 61, 0, MOVE_MIDI_SOURCE_FX_BROADCAST); assert(ds->nheld == 0);

    /* all notes off: only the channel it arrives on, and the notes really are forgotten */
    on(d, 1, 60); on(d, 2, 64); g_now += 40; assert(ds->nheld == 2);
    { uint8_t m[3] = { 0xB1, 123, 0 }; cd_on_midi(d, m, 3, MOVE_MIDI_SOURCE_FX_BROADCAST); }
    assert(ds->nheld == 1);
    { uint8_t m[3] = { 0xB0, 123, 0 }; cd_on_midi(d, m, 3, MOVE_MIDI_SOURCE_FX_BROADCAST); }
    assert(ds->nheld == 0);
    on(d, 1, 72); g_now += 40;
    assert(head_is(d, "72"));                               /* not "60,64,72": nothing stuck */
    off(d, 1, 72);

    /* messages too short to be a note, or without a status byte, are ignored */
    { uint8_t m[2] = { 0x90, 60 }; cd_on_midi(d, m, 2, MOVE_MIDI_SOURCE_FX_BROADCAST); }
    { uint8_t m[1] = { 0x90 }; cd_on_midi(d, m, 1, MOVE_MIDI_SOURCE_FX_BROADCAST); }
    { uint8_t m[3] = { 60, 100, 0 }; cd_on_midi(d, m, 3, MOVE_MIDI_SOURCE_FX_BROADCAST); }   /* running status */
    cd_on_midi(d, NULL, 3, MOVE_MIDI_SOURCE_FX_BROADCAST);
    cd_on_midi(NULL, (const uint8_t[]){ 0x90, 60, 100 }, 3, MOVE_MIDI_SOURCE_FX_BROADCAST);
    g_now += 40;
    assert(ds->nheld == 0 && head_is(d, "72"));

    /* other messages are ignored without harm */
    { uint8_t m[3] = { 0xE0, 1, 64 }; cd_on_midi(d, m, 3, MOVE_MIDI_SOURCE_FX_BROADCAST); }
    { uint8_t m[1] = { 0xF8 }; cd_on_midi(d, m, 1, MOVE_MIDI_SOURCE_FX_BROADCAST); }
    assert(ds->nheld == 0);

    c = d;

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
