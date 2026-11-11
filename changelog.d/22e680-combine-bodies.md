fix

- A piece of a Combine used as the tool of a later Combine no longer makes that Combine's new piece vanish from the Bodies list and the exported STL (#499): a used-up piece is no longer counted as one its Combine failed to make (browser.ts `failedIds`, used by the workspace).
- Export STL works while a Combine in the timeline is failed (#500): the download reads the last rebuild's failed set, so a failed Combine uses up nothing; its refusal names "Body N", not an internal id.
- Selecting a Combine's second new piece shows that piece's own name and numbers in the Body panel (#501).
- Tests: three new Design test files on the real kernel (each failed before its fix), browser check `e2e/combine-body-lists.mjs`.

public: none
