fix

- The random-testing clock no longer stops after starting a run: it crashed reading the reply to its own start request, so the next clock, the app's daytime runs and on some nights the night itself waited for GitHub's late hourly restart.

public: none
