none

- Kernel CI security: the coverage report job (the pilot) is split so the job that runs the kernel holds only a read-only key, a separate job holds the key that writes results and never runs kernel code, and the files pass between them sealed. New checks pin this.

public: none
