# Changelog

## [1.1.1](https://github.com/FilOzone/early-repair/compare/repair-cli-v1.1.0...repair-cli-v1.1.1) (2026-10-29)


### Bug Fixes

* keep pulls within Curio's admission limits ([#63](https://github.com/FilOzone/early-repair/issues/63)) ([cc0156c](https://github.com/FilOzone/early-repair/commit/cc0156c238050189cc263a5d4b634e609c308a16))

## [1.1.0](https://github.com/FilOzone/early-repair/compare/repair-cli-v1.0.0...repair-cli-v1.1.0) (2026-10-29)


### Features

* size addPieces batches by message limit ([#61](https://github.com/FilOzone/early-repair/issues/61)) ([cd2d84d](https://github.com/FilOzone/early-repair/commit/cd2d84d3395e176b482211da458d3828c670b62c))

## [1.0.0](https://github.com/FilOzone/early-repair/compare/repair-cli-v0.4.0...repair-cli-v1.0.0) (2026-10-28)


### ⚠ BREAKING CHANGES

* the indexer Postgres URL settings are gone. `providers list` piece counts/sizes and `datasets list` piece counts now require --stats, and `datasets show` returns the API's data set shape (e.g. `owner` instead of `payer`, numbers as strings).

### Features

* read providers, datasets and pieces from the Filecoin API ([#59](https://github.com/FilOzone/early-repair/issues/59)) ([7d08a3a](https://github.com/FilOzone/early-repair/commit/7d08a3a44b09a213f8053e9cca3934a14320bf8b))

## [0.4.0](https://github.com/FilOzone/early-repair/compare/repair-cli-v0.3.0...repair-cli-v0.4.0) (2026-07-30)


### Features

* second copy ([#52](https://github.com/FilOzone/early-repair/issues/52)) ([b010be1](https://github.com/FilOzone/early-repair/commit/b010be123b84ba377ca8c09feeb892395a0c65f8))

## [0.3.0](https://github.com/FilOzone/early-repair/compare/repair-cli-v0.2.1...repair-cli-v0.3.0) (2026-06-19)


### Features

* enhance repair CLI with session key management and improve wallet commands ([a1c687a](https://github.com/FilOzone/early-repair/commit/a1c687a7920d2fef3d7e7f87b33066a213270bb5))

## [0.2.1](https://github.com/FilOzone/early-repair/compare/repair-cli-v0.2.0...repair-cli-v0.2.1) (2026-06-19)


### Bug Fixes

* improve setup command and ignore metadata on repairs ([a086263](https://github.com/FilOzone/early-repair/commit/a086263a08da6192175475dc3ebc06ceec7aff90))

## [0.2.0](https://github.com/FilOzone/early-repair/compare/repair-cli-v0.1.2...repair-cli-v0.2.0) (2026-06-18)


### Features

* enhance repair CLI with replication functionality ([3acf6c1](https://github.com/FilOzone/early-repair/commit/3acf6c1c77718adad45a2a46950235448b615d53))

## [0.1.2](https://github.com/FilOzone/early-repair/compare/repair-cli-v0.1.1...repair-cli-v0.1.2) (2026-06-15)


### Bug Fixes

* update synapse and add terminate dataset ([a871ae7](https://github.com/FilOzone/early-repair/commit/a871ae76dd4da45d87605c35b3b73b43acabb568))

## [0.1.1](https://github.com/FilOzone/early-repair/compare/repair-cli-v0.1.0...repair-cli-v0.1.1) (2026-06-12)


### Bug Fixes

* update CLI command and example in documentation ([8e473d4](https://github.com/FilOzone/early-repair/commit/8e473d44bc5afb9304e51c8750d3e492b79703a9))

## [0.1.0](https://github.com/FilOzone/early-repair/compare/repair-cli-v0.0.7...repair-cli-v0.1.0) (2026-06-11)


### Features

* enhance repair-cli with new filtering and upsert functionalities ([e098865](https://github.com/FilOzone/early-repair/commit/e098865c74d057cc45cad749eaaf0c7d10c5b315))
* repair cli initial version ([3ec48e2](https://github.com/FilOzone/early-repair/commit/3ec48e2018957b6b11c0e7062288c4c4e28ef1f0))


### Bug Fixes

* fix bin path ([e713e63](https://github.com/FilOzone/early-repair/commit/e713e632ec1efe47cfb7701b2ca60706754a2b80))
* progress and new synpase-core ([5c1532c](https://github.com/FilOzone/early-repair/commit/5c1532c7a863d898d8ba5eb8d6aa961454813b83))
* streamline database migration ([a40f665](https://github.com/FilOzone/early-repair/commit/a40f66534b898dc1d95916b9ed878850197e0d72))
