fix

- The timeline fuzzing no longer reports two false alarms: a sketch drawn on a copy of a combined body, which the test's model wrongly called lost (#430), and a typed size that stops a Move from moving one of its bodies, which the test wrongly counted as changing an unrelated item (#482). Design was right in both; the test's model and its check are fixed, with a hand-worked test and the shrunk sessions kept as regressions.

public: none
