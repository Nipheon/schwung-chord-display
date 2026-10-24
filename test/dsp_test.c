/* Native test of the note latch and Hold timer: cc -Isrc/dsp test/dsp_test.c && ./a.out */
#include <assert.h>
#include <stdio.h>
#include "../src/dsp/chord_display.c"

static uint8_t out[16][3];
static int lens[16];

static void send(void *c, uint8_t st, uint8_t note, uint8_t vel)
{
    uint8_t m[3] = { st, note, vel };
    int n = cd_process_midi(c, m, 3, out, lens, 16);
    assert(n == 1 && lens[0] == 3 && out[0][0] == st && out[0][1] == note && out[0][2] == vel);
}

static void run_ms(void *c, int ms)
{
    for (int t = 0; t < ms; t += 3) cd_tick(c, 128, 44100, out, lens, 16);   /* ~2.9 ms blocks */
}

static const char *notes(void *c)
{
    static char buf[64];
    cd_get_param(c, "chord_notes", buf, sizeof buf);
    return buf;
}

static int head_is(void *c, const char *want)
{
    const char *s = notes(c);
    size_t n = strlen(want);
    return strncmp(s, want, n) == 0 && s[n] == '|';
}

int main(void)
{
    void *c = cd_create(NULL, NULL);
    char buf[64];

    assert(head_is(c, ""));

    /* chord with uneven pad presses counts as one chord after the settle window */
    send(c, 0x90, 60, 100); run_ms(c, 8);
    send(c, 0x90, 64, 100); run_ms(c, 8);
    send(c, 0x90, 67, 100);
    assert(head_is(c, ""));                       /* still settling */
    run_ms(c, 40);
    assert(head_is(c, "60,64,67"));

    /* releasing one by one keeps the chord */
    send(c, 0x80, 67, 0); run_ms(c, 100);
    send(c, 0x90, 64, 0); run_ms(c, 100);          /* note-on vel 0 = off */
    assert(head_is(c, "60,64,67"));

    /* last note up: stays for Hold (default 1000 ms), then clears */
    send(c, 0x80, 60, 0);
    run_ms(c, 900);
    assert(head_is(c, "60,64,67"));
    run_ms(c, 200);
    assert(head_is(c, ""));

    /* a new chord cancels a running Hold and replaces the old one */
    send(c, 0x90, 60, 100); run_ms(c, 40);
    send(c, 0x80, 60, 0); run_ms(c, 500);
    send(c, 0x90, 62, 100); send(c, 0x90, 65, 100); send(c, 0x90, 69, 100); run_ms(c, 40);
    assert(head_is(c, "62,65,69"));
    send(c, 0x80, 62, 0); send(c, 0x80, 65, 0); send(c, 0x80, 69, 0);
    run_ms(c, 600);
    assert(head_is(c, "62,65,69"));                /* only 600 of 1000 ms */

    /* a tap shorter than the settle window still shows */
    run_ms(c, 1500);
    send(c, 0x90, 72, 100); run_ms(c, 5); send(c, 0x80, 72, 0); run_ms(c, 40);
    assert(head_is(c, "72"));

    /* Hold 0 clears at once; the parameter reads back and clamps */
    cd_set_param(c, "hold", "0");
    run_ms(c, 1500);
    send(c, 0x90, 60, 100); run_ms(c, 40); send(c, 0x80, 60, 0);
    assert(head_is(c, ""));
    cd_set_param(c, "hold", "99999");
    cd_get_param(c, "hold", buf, sizeof buf); assert(strcmp(buf, "5000") == 0);
    cd_set_param(c, "state", "{\"hold\":250}");
    cd_get_param(c, "state", buf, sizeof buf); assert(strcmp(buf, "{\"hold\":250}") == 0);

    /* non-note messages pass through unchanged */
    { uint8_t m[3] = { 0xE0, 1, 64 }; assert(cd_process_midi(c, m, 3, out, lens, 16) == 1 && out[0][0] == 0xE0); }
    { uint8_t m[1] = { 0xF8 }; assert(cd_process_midi(c, m, 1, out, lens, 16) == 1 && lens[0] == 1); }

    /* chain_params and key are readable */
    assert(cd_get_param(c, "chain_params", buf, sizeof buf) < 0);   /* 64 B is too small: refuses, no overflow */
    { char big[1024]; assert(cd_get_param(c, "chain_params", big, sizeof big) > 0); }
    assert(cd_get_param(c, "key", buf, sizeof buf) > 0 && strncmp(buf, "-1|", 3) == 0);

    cd_destroy(c);
    puts("dsp ok");
    return 0;
}
