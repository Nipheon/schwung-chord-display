/* Native test on the REAL clock (dsp_test.c replaces it with one it can move):
 * cc -Isrc/dsp test/dsp_clock_test.c -ldl -o <out> && <out> */
#include <assert.h>
#include <stdio.h>
#include <time.h>

#include "../src/dsp/chord_display.c"

static void sleep_ms(int ms)
{
    struct timespec ts = { ms / 1000, (long)(ms % 1000) * 1000000L };
    nanosleep(&ts, NULL);
}

int main(void)
{
    /* the clock itself: positive, never goes backwards, and really advances */
    double a = now_ms();
    sleep_ms(20);
    double b = now_ms();
    assert(a > 0 && b >= a + 15 && b < a + 2000);

    audio_fx_api_v2_t *api = move_audio_fx_init_v2(NULL);
    void *c = api->create_instance(NULL, NULL);
    char buf[128];
    api->set_param(c, "channel", "Omni");

    const uint8_t notes[3] = { 60, 64, 67 };
    for (int i = 0; i < 3; i++) {
        uint8_t m[3] = { 0x90, notes[i], 100 };
        move_audio_fx_on_midi(c, m, 3, MOVE_MIDI_SOURCE_FX_BROADCAST);
    }
    /* the settle window closes by itself, with no later note and no tick, once
     * the real time has passed and the chord is read */
    sleep_ms(80);
    api->get_param(c, "chord_notes", buf, sizeof buf);
    assert(strncmp(buf, "60,64,67|", 9) == 0);

    api->destroy_instance(c);
    puts("clock ok");
    return 0;
}
