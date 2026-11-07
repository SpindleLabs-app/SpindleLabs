fix

- Kernel CI: the checks no longer fail when the package download is slow; only the checks that need those packages download them, and slow downloads wait and try again.
