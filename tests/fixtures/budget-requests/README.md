# Budget-request extraction regression sources

Official, public FY2027 (令和9年度) sources retrieved on 2026-10-08. These are
source excerpts for deterministic parser tests, not invented budget examples.
Tests are offline and do not require Poppler, OCR, network access, or LLM keys.
The existing `pdf-parse` dependency supplies `pdfjs-dist` and Japanese CMaps.

| Fixture | Official source | Contents / regression |
| --- | --- | --- |
| `cao-r09-12.pdf` | https://www.cao.go.jp/yosan/soshiki/r09/pdf/12.pdf | Unmodified complete 3-page government-PR detail table. Normal request 7,884,742千円 = 78.84742億円; this is not the 280.49億円 overview including other frames. Reverse-ordered digit fragments, blank hierarchy amounts, multiline labels, future-year commitment figures in remarks. |
| `mext-r09-regressions.pdf` | https://www.mext.go.jp/content/20260907_mxt_kaikesou01-000051991_3.pdf | Original PDF pages 1, 3, 386 in that order. Merged text item `0 △` straddles previous/request cells; source request number 100 must not become an organizational code. The excerpt intentionally omits most descendants, so its subtotals are incomplete. |
| `mof-r09-summary-5.pdf` | https://www.mof.go.jp/about_mof/mof_budget/budget/fy2027/2027ippan_2.pdf | Original PDF page 5, a 総表 with multiple category subtotals. Must remain unsupported instead of concatenating columns or duplicating detail totals. |

SHA-256 of committed fixtures:

- CAO: `8f80308324109ff101a0cfaa09a3188e85ac86244c104287a5ef111ecbbf4bda`
- MEXT excerpt: `dd5bb1edf08cbcafb9e520761e60fdbf4096b26022861bcb57909f6f515b817f`
- MOF excerpt: `14550c299d2f820ef62cb9c934927c31078e953a38f315d946c553c0747624d3`

## Parser coverage

- Standard coordinate-layout 歳出概算要求額明細表: source hierarchy and amounts,
  including blank wrappers and negative figures; remarks are never extra rows.
- CSV/TSV with explicit Japanese name/frame headers, UTF-8 or Shift-JIS, quoted
  fields and multiline CSV cells. Units may be in headers or a unit column.
- Existing MOF `clm`-coordinate XML with explicit matching headers. No XML entity
  or DTD expansion. Ambiguous multiple monetary cells are reported as failed.
- Separate request, demand, and special-investment fields; no frame addition.
- Row/source fiscal-year validation, exact integer-yen conversion, previous-year
  change and disjoint hierarchy subtotal checks, explicit unresolved states.

Not covered: arbitrary ministry overview layouts, scanned PDF/OCR, Excel files,
PDF summary category tables, and non-MOF XML schemas. Unsupported files and
unparsed pages remain visible in acquisition status. No inferred publication
fiscal year, RS sheet fiscal year, or RS links are invented.

## Previous-year negative-sign source regressions

Added after testing the broader acquired corpus: PDF.js can merge a negative sign
from the previous-year cell into the preceding project-name item. Position that
last painted glyph by the right edge, not uniform Japanese character spacing.

| Fixture | Official source | Original PDF pages | Check |
| --- | --- | --- | --- |
| `clb-r09-negative-signs.pdf` | https://www.clb.go.jp/files/topics/5329_ext_05_2.pdf | 7, 8 | 職員基本給: previous -5,077千円; request 0千円 |
| `kunaicho-r09-negative-signs.pdf` | https://www.kunaicho.go.jp/wp-content/uploads/2026/08/r09-03.pdf | 7, 8 | 職員基本給: previous -19,659千円; request -16,401千円 |
| `jcrc-r09-negative-signs.pdf` | https://www.jcrc.go.jp/content/000002960.pdf | 7, 9 | 職員基本給: previous -7,021千円; request -6,136千円 |

These excerpts omit later descendants, so hierarchy completeness is not asserted.
SHA-256:

- CLB: `eb553fc24090d05bb9c3c17bb36ccd390ef89a5328c35762d1cfe454f7287266`
- Kunaicho: `6b7a0c53f2ddd50ff48550a9df6e14f7509441bf6ee3db0c71464826a1d46c90`
- JCRC: `44f36fe9d76e45ce3a0bbcf5e5c2373366557468bf960c2771a650421fec485c`

The arithmetic safety check marks conflicting current and previous figures as
`extraction_failed`, retaining source raw text and evidence, if a comparison
triple remains inconsistent after coordinate extraction.

## Special-account code and account-heading regressions

Unmodified complete cached official PDFs, retrieved 2026-10-08. Reconstruction
contains all 5 original pages, reinsurance all 9, and account heading all 5.
The fixture hashes below are also the hashes of the original official bytes:

| Fixture | Official source | Check |
| --- | --- | --- |
| `mof-r09-reconstruction.pdf` | https://www.mof.go.jp/about_mof/mof_budget/budget/fy2027/2027fukkou_2.pdf | Three-digit central codes with internal spaces. Page 4: 復興債償還財源等国債整理基金特別会計へ繰入, previous 47,658,341千円 / request 63,923,795千円. |
| `mof-r09-reinsurance.pdf` | https://www.mof.go.jp/about_mof/mof_budget/budget/fy2027/2027jisinn_2.pdf | One-digit central codes split across two positioned text items, e.g. `95199-` + `9-21-6020`. |
| `mof-r09-account-heading.pdf` | https://www.mof.go.jp/about_mof/mof_budget/budget/fy2027/2027tokuzai_2.pdf | One-digit account heading `3 特定国有財産整備勘定` with its own explicit amounts and descendants. |

SHA-256:

- Reconstruction: `9b652e4cb5a77afd698e7b5ed555bdaeee9f7d50e31fba5c592713de9285f564`
- Reinsurance: `26a8813cdca485dee3ca1b0fbf05074e6a4aa0d98b293feae6c46512a3b7f2a1`
- Account heading: `6185121e63dd791698010115b8b038fcad2bce62938b75513dc604f2806450ee`

Synthetic coordinate tests additionally cover long whole/fragmented amounts that
cross a header midpoint, with blank or 事項要求 comparison cells. Physically
overlapping cells, separate ambiguous numeric runs and merged `100 200` items
must fail closed; no partial numeric value is kept. CSV delta columns are used
only to validate an explicit current/prior pair, never to infer a missing figure.

Signed-overflow tests keep adjacent signs and leading digit fragments with their
whole amount before column assignment. Touching per-digit runs are ambiguous
without a consistent explicit numeric request/prior/change triple; blank or
事項要求 comparison cells make the affected monetary cells extraction_failed.
