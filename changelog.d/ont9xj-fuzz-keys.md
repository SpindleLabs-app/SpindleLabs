none

- Kernel fuzzing's jobs that run kernel code now hold only a read-only key: they seal their results and a separate job, which runs no kernel code, saves them.
- The app's fuzzing and random testing check their models with a read-only key too, so no workflow uses the old all-in-one key any more.

public: none
