none

- The browser smoke test saves its file to a temporary folder instead of over a committed test file, so the other checks that read that file no longer depend on which run wrote it last.

public: none
