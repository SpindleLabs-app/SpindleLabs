none

- Kernel CI security: the kernel checks and the mutation tests are split like the coverage job, so the jobs that run kernel code hold only a read-only key and the jobs that save results and set the checks hold the writing keys and run no kernel code; files pass between them sealed. A failing check part now reports when all parts are done instead of at once.

public: none
