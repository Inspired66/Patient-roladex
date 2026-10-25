// No-audio probe against the Vosk C API (desktop libvosk.so loaded with dlopen; prototypes declared by hand).
// Usage: grammar_probe LIBVOSK.so MODEL_DIR GRAMMAR.json WORD...
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef void *(*model_new_t)(const char *);
typedef int (*find_word_t)(void *, const char *);
typedef void *(*rec_grm_t)(void *, float, const char *);
typedef void *(*rec_new_t)(void *, float);
typedef void (*free_t)(void *);

static long rss_mb(void) {
    FILE *f = fopen("/proc/self/status", "r");
    char line[256];
    long kb = -1;
    while (f && fgets(line, sizeof line, f))
        if (!strncmp(line, "VmRSS:", 6)) kb = atol(line + 6);
    if (f) fclose(f);
    return kb / 1024;
}

static double now(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + t.tv_nsec / 1e9;
}

int main(int argc, char **argv) {
    if (argc < 4) return 2;
    void *lib = dlopen(argv[1], RTLD_NOW);
    if (!lib) { fprintf(stderr, "dlopen failed: %s\n", dlerror()); return 1; }
    model_new_t model_new = dlsym(lib, "vosk_model_new");
    find_word_t find_word = dlsym(lib, "vosk_model_find_word");
    rec_grm_t rec_grm = dlsym(lib, "vosk_recognizer_new_grm");
    rec_new_t rec_new = dlsym(lib, "vosk_recognizer_new");
    free_t model_free = dlsym(lib, "vosk_model_free");
    free_t rec_free = dlsym(lib, "vosk_recognizer_free");
    void (*set_log)(int) = dlsym(lib, "vosk_set_log_level");
    set_log(0);
    printf("rss before model: %ld MB\n", rss_mb());
    double t = now();
    void *model = model_new(argv[2]);
    if (!model) return 1;
    printf("model load %.2f s, rss %ld MB\n", now() - t, rss_mb());
    for (int i = 4; i < argc; i++)
        printf("find_word(%s) = %d\n", argv[i], find_word(model, argv[i]));
    FILE *g = fopen(argv[3], "r");
    char grammar[8192] = {0};
    fread(grammar, 1, sizeof grammar - 1, g);
    fclose(g);
    t = now();
    void *r = rec_grm(model, 16000.0f, grammar);
    printf("grammar recognizer %s in %.2f s, rss %ld MB\n", r ? "created" : "FAILED", now() - t, rss_mb());
    if (r) rec_free(r);
    r = rec_new(model, 16000.0f);
    printf("plain recognizer %s, rss %ld MB\n", r ? "created" : "FAILED", rss_mb());
    if (r) rec_free(r);
    model_free(model);
    return 0;
}
