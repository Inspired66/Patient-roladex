// Counts whisper tokens of a prompt read from stdin. Used to size the initial prompt (limit 224).
// Build: see README ("Prompt token budget").
#include <cstdio>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>
#include "whisper.h"

int main(int argc, char ** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: token_count MODEL.bin < prompt.txt\n");
        return 2;
    }
    whisper_context_params cp = whisper_context_default_params();
    cp.use_gpu = false;
    whisper_context * ctx = whisper_init_from_file_with_params(argv[1], cp);
    if (!ctx) {
        return 1;
    }
    std::string text((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    while (!text.empty() && (text.back() == '\n' || text.back() == ' ')) {
        text.pop_back();
    }
    std::vector<whisper_token> tokens(4096);
    int n = whisper_tokenize(ctx, text.c_str(), tokens.data(), (int) tokens.size());
    std::printf("%d\n", n);
    whisper_free(ctx);
    return 0;
}
