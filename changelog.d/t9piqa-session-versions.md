fix

- Earlier versions now keep the state a work session ended in: a state that was left unchanged for ten minutes or more is kept as a version when the next save replaces it, in the browser and (after a new database migration the owner applies) in the account. Before, the last ten minutes of a session were thrown away when the next session saved over them, even a week later (issue #628, item 3).
- The privacy page says so.

public:
- Earlier versions now always include how you left a design last time, so a wrong change made days later can be taken back.
