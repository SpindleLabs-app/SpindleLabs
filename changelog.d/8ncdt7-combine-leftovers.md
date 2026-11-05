none

- In the hidden Combine tool, a sketch on a face that came from the second body no longer slides along that face when you change a Move of the first body.
- Points on other bodies stay snappable while sketching on a face that a later Combine splits.
- A picked face of a combined body whose neighbours changed is now reported as lost instead of quietly landing on a similar face.
- A Combine the kernel refuses because the result would be too thin now fails on its own row instead of stopping the whole design from rebuilding.
- A picked edge of a combined body that is still the only edge between its two faces stays picked when the faces at its ends change, with a note asking you to check it.
