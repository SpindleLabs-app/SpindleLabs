fix

- TestLab's time limit for a stress test now matches the kernel's thin-plate meshing: thin plates (2.5 mm and under) get enough time to finish, a mesh size close to a part's thickness is no longer stopped before it finishes, and a part whose size is not known yet waits at most about 60% as long as before.
- A new check bends a 1 mm steel strip and compares the bend and stress with beam and plate theory.

public: none
