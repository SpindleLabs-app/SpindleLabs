fix

- A long session no longer piles up a page listener for every panel opened: the panels that follow the chosen unit now share one listener, which holds them only weakly (the soak test's listener count grew about 13 a cycle).
- Tests: every TypeScript mutation survivor from the last nightly in picking, boolean names, the naming model and Design's document is killed by a hand-worked test or explained, and stale explanations are gone.
- Tests: the naming model's independent unit-cell check now follows two rules it had missed (a reference whose split piece is gone is found with a warning; an edge named with its ends finds the only edge left between its faces, and says so), with the failing sessions kept.

public: none
