fix

- While a Cut or Join that changes nothing waits for its question to be answered, the app no longer counts that as work still running: the page is waiting for the person, so the random testing's "the page was still changing" check no longer waits on it for good. Undo pressed in the meantime still waits for the answer, as before.

public: none
