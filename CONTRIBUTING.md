# Contributing

Thanks for helping traders keep their discipline.

- Run `npm test`, `npm run typecheck` and `npm run e2e` before opening a pull request.
- New rules belong in `src/core/` as pure functions with unit tests. They must quote real numbers in their message and never move funds or place orders.
- Site adapters: see "Adding a site" in the README.
- Keep the Privacy table in the README true. Any new outbound request needs a row there and a reason in the PR.

## License of contributions

The project is licensed under AGPL-3.0. By submitting a contribution you confirm you wrote it (or have the right to submit it) and you agree it is licensed under AGPL-3.0, and you also grant the maintainers a perpetual, worldwide, royalty-free license to use, modify and relicense your contribution under other terms. This keeps the project able to offer commercial licenses and partnerships. If you don't want to grant that, say so in your PR before it's merged.
