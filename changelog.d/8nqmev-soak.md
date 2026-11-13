fix

- A long session no longer holds on to the panels of every workspace shown before: switching workspaces, opening split view or a file kept two more empty panels in memory each time, so the page kept growing for as long as it stayed open (the soak test's "nodes keeps growing").

public:
- Long sessions with many workspace switches no longer use more and more memory.
