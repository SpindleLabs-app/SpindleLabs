fix

- The Image workspace's Open button refuses an image file over 512 MB before reading it, with the same message as a dropped one, instead of reading the whole file and freezing the tab.
- The mouse settings call the corner cube the orientation cube.
- The browser checks' switch for tooltips and timeline cards is left out of the live app, and the deploy now fails if it ever leaks in.
- The in-browser AI model now shows its download size (about 900 MB) straight away and contacts its download site only after you agree; before, saying yes to a first question let the site see your address just to look up the size.
- The note under the AI key box now says that pasting a key, as well as saving it, asks the provider which models it can use.

public:
- Very large image files (over 512 MB) are now refused when opened in the Image workspace, instead of freezing the page.
- The mouse settings now call the cube in the corner of the view the orientation cube.
- The in-browser AI model now asks once, with its size, before contacting its download site at all.
