# approved-dependencies — new packages need a review

**Question to ask yourself:** could an approved package, or a few lines of our own code, do this?

## Why
Every dependency is code we ship, patch and licence. The allow-list in `.copalrules` is what #platform-deps has
reviewed. AI assistants add packages freely; this rule makes that a decision instead of an accident.

## How to add one
Open a request in #platform-deps with: what it replaces, licence, maintenance activity, size. Once approved, add it
to `allow` in `.copalrules` in the same PR.
