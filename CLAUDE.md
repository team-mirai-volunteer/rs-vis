# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Essential Commands

### Development
```bash
npm run dev                      # Start dev server (localhost:3002 with Turbopack)
npm run build                    # Production build (auto-decompresses .gz data)
npm start                        # Production server
npm run lint                     # ESLint check
```

### Data Pipeline (After updating CSV files)
```bash
npm run normalize                # Python CSV normalization (requires: pip3 install neologdn)
npm run generate-structured      # Generate rs2024-structured.json (46MB)
npm run generate-preset          # Generate rs2024-preset-top3.json (32KB)
npm run compress-data            # Gzip structured JSON for Git (5.9MB)
```

### Data Location
- **Source CSV**: `data/download/RS_2024/` (manual download from rssystem.go.jp)
- **Normalized CSV**: `data/year_2024/` (auto-generated, .gitignore)
- **Structured JSON**: `public/data/rs2024-structured.json` (46MB, .gitignore)
- **Compressed JSON**: `public/data/rs2024-structured.json.gz` (5.9MB, in Git)
- **Preset JSON**: `public/data/rs2024-preset-top3.json` (32KB, in Git)

### Critical Path Aliases
- Import alias `@/*` maps to repository root (e.g., `@/types/structured`)

### Key Architectural Decisions
1. **Data Compression Strategy**: Store `.gz` files in Git (5.9MB), decompress during build via `prebuild` hook
2. **URL State Management**: All view state syncs with URL query params for shareable/bookmarkable views
3. **5-Column Sankey**: Budget Budget Budget → Spending Spending (green for budget nodes, red for spending)
4. **"その他" vs "その他の支出先"**: Two separate final nodes - "その他" for recipients named "その他" (~26T¥), "その他の支出先" for non-TopN items (~51T¥)
5. **In-Memory Caching**: Server caches rs2024-structured.json in memory for fast API responses

### Main Entry Points
- **UI**: [app/sankey/page.tsx](app/sankey/page.tsx) - Main visualization with state management (859 lines)
- **API**: [app/api/sankey/route.ts](app/api/sankey/route.ts) - Dynamic Sankey data endpoint
- **Core Logic**: [app/lib/sankey-generator.ts](app/lib/sankey-generator.ts) - Sankey generation algorithm (936 lines)
- **Data Scripts**: [scripts/](scripts/) - CSV normalization and JSON generation pipeline

### Documentation Standards
- **Naming Convention**: `/docs` directory uses `YYYYMMDD_HHMM_タイトル.md` format
  - Example: `20251130_2220_支出ビュー仕様.md`
  - Ensures chronological ordering and easy identification

---

# RS2024 Sankey Diagram System - Architecture & Technical Overview

## Project Summary

This is a **Next.js-based web application** that visualizes Japan's 2024 fiscal year budget and spending data through interactive Sankey diagrams. The system processes CSV data from the Administrative Review System (RS System) and presents budget flows across 5 columns: Total Budget → Ministries → Projects (Budget) → Projects (Spending) → Spending Recipients.

**Key Statistics**:
- Total Budget: 146.63 trillion yen
- Total Projects: 15,111
- Total Spending Recipients: 25,892
- Coverage Rate (Top3 view): 50.18% (73.58 trillion yen)

---

## 1. Overall Architecture & Data Flow

### High-Level Flow

```
CSV (RS System) 
  ↓
[normalize_csv.py] - Text normalization using neologdn
  ↓
Normalized CSV (data/year_2024/)
  ↓
[generate-structured-json.ts] - Full hierarchical data structure
  ↓
rs2024-structured.json (46MB) → rs2024-structured.json.gz (5.9MB)
  ↓
[generate-preset-json.ts] - Pre-generated Top3 Sankey data
  ↓
rs2024-preset-top3.json (32KB) - Static preset
  ↓
[API Route: /api/sankey] - Dynamic Sankey generation
  ↓
[Frontend: /sankey page] - Interactive visualization with Nivo Sankey
```

### Data Processing Pipeline (CSV → JSON)

#### Phase 1: CSV Normalization (normalize_csv.py)
**Input**: ZIP files from RS System (data/download/RS_2024/)
**Output**: UTF-8 normalized CSV files (data/year_2024/)

Normalization steps:
1. **neologdn**: Japanese text normalization (highest priority)
2. Circled numbers conversion: ① → 1
3. Unicode NFKC normalization
4. Era-to-Western year conversion: 令和5年 → 2024年
5. Full-width to half-width bracket conversion: （） → ()
6. Hyphen unification (multiple Unicode variants → -)
7. Katakana choon mark fixes: ア- → アー
8. Consecutive whitespace removal

**Files Processed**:
- 1-1_RS_2024_基本情報_組織情報.csv (Organization hierarchy)
- 1-2_RS_2024_基本情報_事業概要等.csv (Project overview)
- 2-1_RS_2024_予算・執行_サマリ.csv (Budget & execution summary)
- 5-1_RS_2024_支出先_支出情報.csv (Spending recipient info)

#### Phase 2: Structured JSON Generation (generate-structured-json.ts)
**Input**: Normalized CSV files
**Output**: rs2024-structured.json (46MB uncompressed)

Creates hierarchical structure:
- **BudgetTree**: Ministry → Bureau → Department → Division → Office → Group → Section
- **BudgetRecord[]**: Individual project budget details with hierarchy path
- **SpendingRecord[]**: Spending recipient details with projects
- **Statistics**: Ministry-level, project-level, and recipient-level aggregations

Key processing:
1. Build organization maps from CSV rows
2. Construct budget records linking orgs to budgets
3. Build spending records linking projects to recipients
4. Create hierarchical budget tree for efficient navigation
5. Generate statistics for top entities

#### Phase 3: Preset JSON Generation (generate-preset-json.ts)
**Input**: rs2024-structured.json
**Output**: rs2024-preset-top3.json (32KB)

Implements recursive Top3 selection:
1. Select Top3 ministries (by budget)
2. For each ministry, select Top3 projects (by budget)
3. For each project, select Top3 spending recipients (by amount)
4. Aggregate all remaining items as "Other" nodes
5. Build Sankey nodes and links with proper structure

#### Phase 4: Build-Time Data Decompression (decompress-data.sh)
**Trigger**: `npm run build`
**Action**: Automatically decompresses `.gz` file to JSON for runtime use
**Why**: Reduces Git repository size from 110MB to 5.9MB while keeping data available at runtime

---

## 2. Key Directories & Their Purposes

```
marumie-rssystem/
├── app/                              # Next.js App Router (Server + Client)
│   ├── layout.tsx                   # Root HTML structure
│   ├── page.tsx                     # Home page with navigation
│   ├── sankey/
│   │   └── page.tsx                # Interactive Sankey visualization (MAIN UI)
│   ├── api/sankey/
│   │   └── route.ts                # Dynamic Sankey data generation endpoint
│   ├── lib/
│   │   └── sankey-generator.ts     # Core Sankey data generation logic (936 lines)
│   ├── budget-drilldown/           # Future: Budget drill-down analysis
│   └── spending-bottomup/          # Future: Spending source analysis
│
├── client/                          # Reusable client-side code
│   ├── components/                 # React components
│   │   ├── LoadingSpinner.tsx
│   │   ├── TopNSettingsPanel.tsx   # Settings dialog UI
│   │   ├── SankeyBudgetDrilldown.tsx
│   │   └── SankeySpendingBottomup.tsx
│   ├── hooks/
│   │   └── useTopNSettings.ts      # Custom hook for TopN state management
│   └── lib/
│       ├── buildHierarchyPath.ts   # Org hierarchy traversal
│       └── formatBudget.ts         # Currency formatting utilities
│
├── types/                          # TypeScript type definitions
│   ├── structured.ts              # Full data structure types
│   ├── preset.ts                  # Sankey visualization types
│   ├── sankey.ts                  # Sankey graph types
│   └── rs-system.ts               # Original CSV structure types
│
├── scripts/                        # Data generation & processing
│   ├── normalize_csv.py           # CSV text normalization (Python)
│   ├── csv-reader.ts              # CSV parsing utility
│   ├── generate-structured-json.ts # Create full JSON from CSV
│   ├── generate-preset-json.ts    # Create Top3 preset
│   └── decompress-data.sh         # Build-time .gz decompression
│
├── data/                          # Raw & processed data (.gitignore)
│   ├── download/RS_2024/          # Manual ZIP download location
│   └── year_2024/                 # Normalized CSV files
│
├── public/data/                   # Generated JSON files
│   ├── rs2024-structured.json.gz  # Gzipped (5.9MB, in Git)
│   ├── rs2024-structured.json     # Uncompressed (46MB, .gitignore)
│   └── rs2024-preset-top3.json    # Pre-generated Top3 (32KB)
│
└── docs/                          # Documentation
    ├── 20251118_型定義仕様.md      # Type definitions spec
    ├── 20251118_1530_データ処理仕様.md  # Data processing spec
    ├── 20251118_新リポジトリ設計.md # System design doc
    ├── サンキー図可視化仕様書.md   # Sankey spec
    ├── 構造化JSON仕様書.md         # Structured JSON spec
    └── プリセットJSON仕様書.md     # Preset JSON spec
```

---

## 3. Data Flow: CSV to Visualization

### Data Model Hierarchy

#### BudgetRecord (Individual Project)
```typescript
{
  projectId: number
  projectName: string
  fiscalYear: 2024
  
  // Organization hierarchy (7 levels)
  ministry: string              // 府省庁
  bureau: string                // 局・庁
  department: string            // 部
  division: string              // 課
  office: string                // 室
  group: string                 // 班
  section: string               // 係
  hierarchyPath: string[]       // Full path for UI
  
  // Budget breakdown (in yen)
  initialBudget: number        // 当初予算
  supplementaryBudget: number  // 補正予算
  carryoverBudget: number      // 前年度繰越
  reserveFund: number          // 予備費等
  totalBudget: number          // Total (歳出予算現額合計)
  
  // Execution info
  executedAmount: number       // 執行額
  executionRate: number        // 執行率 (%)
  carryoverToNext: number      // 翌年度繰越
  
  // Relationships
  spendingIds: number[]        // Links to SpendingRecord.spendingId
  totalSpendingAmount: number  // Sum of spending
}
```

#### SpendingRecord (Recipient Organization)
```typescript
{
  spendingId: number
  spendingName: string         // 支出先名
  
  // Corporate info
  corporateNumber: string      // 法人番号
  location: string             // 所在地
  corporateType: string        // 法人種別
  
  // Spending summary
  totalSpendingAmount: number  // Total spending (yen)
  projectCount: number         // Number of projects funding this recipient
  
  // Detailed project spending
  projects: {
    projectId: number
    amount: number             // Amount from this specific project
    blockNumber: string        // 支出先ブロック番号
    blockName: string          // Support block name
    contractSummary: string    // Contract description
    contractMethod: string     // Contract type
  }[]
}
```

#### BudgetTree (Hierarchy Navigation)
```typescript
{
  totalBudget: number
  ministries: MinistryNode[]
}

// Each level has children and projectIds
MinistryNode {
  id: number
  name: string
  totalBudget: number
  bureaus: BureauNode[]
  projectIds: number[]       // Direct projects at this level
}

// Similar structure down to SectionNode
```

### Sankey Data Structure (for Visualization)

#### SankeyNode (5 Column Types)
```typescript
{
  id: string                  // Unique within diagram
  name: string                // Display text
  type: 'ministry-budget' | 'project-budget' | 
        'project-spending' | 'recipient' | 'other'
  value: number               // Budget/spending amount in yen
  originalId?: number         // Reference to source data
  
  details?: {
    // Ministry-specific
    projectCount: number
    bureauCount: number
    
    // Project-specific
    ministry: string
    bureau: string
    initialBudget: number
    totalBudget: number
    executionRate: number
    
    // Recipient-specific
    corporateNumber: string
    location: string
    projectCount: number
  }
}
```

#### SankeyLink (Connections)
```typescript
{
  source: string              // Source node ID
  target: string              // Target node ID
  value: number               // Amount flowing (yen)
  details?: {
    contractMethod?: string
    blockName?: string
  }
}
```

---

## 4. API Structure & Endpoints

### GET /api/sankey

**Purpose**: Generate dynamic Sankey data based on query parameters

**Query Parameters**:
```
offset=0                    // Pagination for ministries (Global view only)
limit=3                     // Number of ministries to show
projectLimit=3              // Number of projects per ministry
spendingLimit=3             // Number of recipients per project
ministryName=string         // Filter to specific ministry (Ministry view)
projectName=string          // Filter to specific project (Project view)
recipientName=string        // Filter to specific recipient (Spending view)
```

**Response** (RS2024PresetData):
```typescript
{
  metadata: {
    generatedAt: ISO8601
    fiscalYear: 2024
    presetType: 'global' | 'ministry' | 'project' | 'spending'
    filterSettings: { topMinistries, topProjects, topSpendings, sortBy }
    summary: {
      totalMinistries: number
      totalProjects: number
      totalSpendings: number
      selectedMinistries: number
      selectedProjects: number
      selectedSpendings: number
      totalBudget: number
      selectedBudget: number
      coverageRate: percentage
    }
  },
  sankey: {
    nodes: SankeyNode[]
    links: SankeyLink[]
  }
}
```

**Server-Side Logic** (sankey-generator.ts):
1. Load rs2024-structured.json (cached in memory)
2. Select data based on view type and filters
3. Build Sankey nodes and links
4. Generate metadata with coverage statistics
5. Return as JSON

---

## 5. Component Hierarchy & UI State Management

### Page: /sankey/page.tsx (Client Component)

**Responsibilities**:
- URL state synchronization (Search params ↔ React state)
- API data fetching based on view state
- Node click handling and view transitions
- Settings dialog management

**State Variables**:
```typescript
// View State (synchronized with URL)
viewMode: 'global' | 'ministry' | 'project' | 'spending'
offset: number                           // Pagination offset
selectedMinistry: string | null
selectedProject: string | null
selectedRecipient: string | null
isInitialized: boolean                   // Prevents double-initialization

// Display Settings
topN: number                             // Global view ministries (default: 3)
ministryTopN: number                     // Ministry view limit (default: 5)
projectViewTopN: number                  // Project view limit (default: 10)
spendingViewTopN: number                 // Spending view limit (default: 10)

// UI State
data: RS2024PresetData | null
loading: boolean
error: string | null
isMobile: boolean
isSettingsOpen: boolean
```

**Key Effects**:

1. **URL Synchronization** (useEffect)
   - On mount: Read search params → set view state
   - On view change: Update URL with new params
   - Enables browser back/forward and shareable URLs (permalinks)

2. **Data Fetching** (useEffect)
   - Triggers on view changes, TopN changes
   - Calls `/api/sankey` with appropriate parameters
   - Caches data in state

3. **Mobile Detection** (useEffect)
   - Detects window < 768px width
   - Adjusts Sankey margins and enables horizontal scroll

**Node Click Handlers**:
```
Click → handleNodeClick(node)
  ├─ If "予算総計" (Total Budget)
  │   └─ Go back one level (ministry → global, or back to previous offset)
  │
  ├─ If "その他の府省庁" (Other Ministries)
  │   └─ Increment offset to show next set of ministries
  │
  ├─ If ministry node
  │   └─ Switch to ministry view with selected ministry name
  │
  ├─ If project node
  │   ├─ If named "その他の事業" → No action (aggregate node)
  │   └─ Else → Switch to project view with selected project name
  │
  └─ If recipient node
      ├─ If named "その他" → Spending view with "その他"
      ├─ If named "その他の支出先" → Increment offset (pagination)
      └─ Else → Switch to spending view with selected recipient name
```

**Breadcrumb Navigation**:
- Always shows: 予算総計 (Total Budget)
- Level 2: Selected ministry name + budget amount
- Level 3: Selected project name + budget amount
- Level 4: Selected recipient name + spending amount
- Each breadcrumb is clickable to navigate back

### Sankey Visualization (ResponsiveSankey from @nivo/sankey)

**Configuration**:
```typescript
margin: { top: 40, right: 200, bottom: 40, left: 200 }  // Desktop
margin: { top: 40, right: 100, bottom: 40, left: 100 }  // Mobile
height: 800px
align: 'justify'
sort: 'input'

// Color scheme
colors = (node) => {
  if (node.name.startsWith('その他')) return '#6b7280'      // Gray
  if (type === 'ministry-budget' | 'project-budget') 
    return '#10b981'                                       // Green (budget)
  if (type === 'project-spending' | 'recipient') 
    return '#ef4444'                                       // Red (spending)
}

// Opacity & interaction
nodeOpacity: 1
nodeHoverOthersOpacity: 0.35
linkOpacity: 0.5
linkHoverOthersOpacity: 0.1
```

**Custom Label Layer**:
- Renders 2-line labels (name + amount) outside nodes
- Budget nodes: right-aligned on left side
- Spending nodes: left-aligned on right side
- Interactive (clickable if appropriate)
- Amount formatting: 兆円 (trillion), 億円 (100 million), 万円 (10k), 円

**Tooltips**:
- Node tooltips: Full details (budget breakdown, execution rate, etc.)
- Link tooltips: Source → Target amounts

---

## 6. URL State Management & Permalinks

### URL Scheme

```
/sankey                                          # Global view, Top3
/sankey?offset=3                                 # Global view, next page
/sankey?ministry=厚生労働省                       # Ministry detail view
/sankey?ministry=厚生労働省&project=プロジェクト名  # Project view
/sankey?recipient=支出先名                       # Spending view (reverse flow)
```

### State Synchronization Flow

```
URL Changed
  ↓
useEffect (searchParams)
  ↓
Parse query params
  ↓
Update viewMode, selectedMinistry, selectedProject, selectedRecipient, offset
  ↓
setIsInitialized(true)
  ↓
useEffect (viewMode, selected*, offset)
  ↓
Fetch data from /api/sankey with parameters
  ↓
Update Sankey diagram
```

### Benefits
- **Shareable links**: Copy URL to share specific view with others
- **Browser history**: Back/forward buttons work naturally
- **Bookmarkable**: Save specific views as bookmarks
- **Deep linking**: Link directly to specific ministries/projects/recipients

---

## 7. Build & Deployment Process

### Local Development

```bash
# Setup
npm install                    # Install dependencies
npm run normalize             # CSV normalization (Python 3 + neologdn)
npm run generate-structured   # Generate full structured JSON
npm run generate-preset       # Generate Top3 preset

# Development
npm run dev                   # Start with Turbopack (localhost:3002)

# Testing
npm run build                 # Production build
npm start                     # Production server
```

### Build Process

1. **prebuild hook** (npm run build)
   - Executes `scripts/decompress-data.sh`
   - Decompresses rs2024-structured.json.gz → json
   - Only decompresses if .gz is newer than .json

2. **Build** (Next.js)
   - Compiles TypeScript
   - Bundles React components
   - Creates optimized .next directory

### Production Deployment (Vercel)

**Vercel Configuration** (vercel.json):
```json
{
  "buildCommand": "npm run build",
  "framework": "nextjs",
  "regions": ["hnd1"]          // Tokyo region
}
```

**Deployment Steps**:
```bash
# After data update
npm run generate-structured   # Create new JSON
npm run compress-data        # Gzip to .gz
git add public/data/rs2024-structured.json.gz
git commit -m "Update structured data"
git push                     # Triggers automatic Vercel build
```

**Build Flow on Vercel**:
1. GitHub webhook triggers build
2. `npm install` runs
3. `npm run build` executes:
   - Decompress .gz file
   - TypeScript compilation
   - Next.js bundling
   - Static export
4. Deploy to Edge Network

**File Size Optimization**:
- Original structured JSON: ~110MB
- Gzipped: ~5.9MB (94% reduction)
- Storage in Git: Only .gz files
- Runtime: Decompressed during build
- This approach keeps repo size manageable while maintaining full data availability

### Environment Variables

```
NODE_ENV=production          # Set by Vercel
```

---

## 8. Data Generation Pipeline Details

### CSV Normalization (normalize_csv.py)

**Input Processing**:
```bash
npm run normalize
```

**Steps**:
1. Unzip all ZIP files in data/download/RS_2024/
2. For each CSV:
   - Detect encoding (try UTF-8, fallback to Shift_JIS)
   - Apply normalization rules
   - Write to data/year_2024/ as UTF-8
3. Clean up extracted files (keep only .zip)

**Normalization Rules** (in order):
```python
1. neologdn.normalize(text)                    # Japanese text normalization
2. convert_circled_numbers(text)               # ① → 1
3. unicodedata.normalize('NFKC', text)         # Unicode canonical form
4. convert_era_to_year(text)                   # 令和5年 → 2024年
5. convert_fullwidth_brackets(text)            # （） → ()
6. unify_hyphens(text)                         # Various dashes → -
7. fix_hyphen_to_choon(text)                   # ア- → アー
8. fix_katakana_choon(text)                    # ア ー ー → アー
9. remove_consecutive_spaces(text)             # Multiple spaces → 1
```

### Structured JSON Generation (generate-structured-json.ts)

**Process**:
```
Read 4 CSV files
  ↓
Build maps: projectId → org info, budget info
  ↓
Create BudgetRecord for each 2024 project
  ├─ Link to organization via hierarchy
  ├─ Parse budget amounts
  └─ Store spending relationships
  ↓
Create SpendingRecord for each recipient
  ├─ Aggregate spending from projects
  └─ Store detailed transaction info
  ↓
Build BudgetTree
  ├─ Aggregate budgets by organization level
  ├─ Create hierarchy: Ministry → Bureau → ... → Section
  └─ Link to project IDs at each level
  ↓
Generate Statistics
  ├─ By ministry
  ├─ Top projects by budget
  ├─ Top projects by spending
  └─ Top spending recipients
  ↓
Write rs2024-structured.json (46MB)
```

**Key Algorithm**: Hierarchy Building
```typescript
// For each budget record
1. Extract hierarchy path: [ministry, bureau, dept, div, office, group, section]
2. Find or create ministry node
3. Recursively create/navigate children
4. Add projectId to leaf node
5. Aggregate totalBudget up the tree
```

### Preset JSON Generation (generate-preset-json.ts)

**Recursive Top3 Selection**:
```
1. Sort ministries by budget
2. Select Top3 ministries
3. For EACH selected ministry:
   a. Get all projects in ministry
   b. Sort by budget
   c. Select Top3 projects
   d. Aggregate rest as "Other"
4. For EACH selected project:
   a. Get all spending recipients (except "その他")
   b. Sort by spending amount
   c. Select Top3 recipients
   d. Aggregate rest as "Other Spending Recipient"
   e. Also track "Named Other" (支出先名 = "その他") separately
5. Build Sankey with 5 columns:
   ├─ Column 1: Total Budget
   ├─ Column 2: Ministry nodes (+ Other)
   ├─ Column 3: Project Budget nodes (+ Other per ministry)
   ├─ Column 4: Project Spending nodes (+ Other per project)
   └─ Column 5: Recipient nodes (+ Other + Other Named Other)
```

**Special Node Handling**:
- **"その他の府省庁"**: Aggregate of non-Top3 ministries (pagination)
- **"その他の事業"**: Per-ministry aggregate of non-Top3 projects
- **"その他"**: Aggregate of spending with recipient name = "その他"
- **"その他の支出先"**: Aggregate of other recipients + other projects/ministries

---

## 9. Key Design Decisions & Considerations

### Architecture Choices

1. **Static vs Dynamic Data**
   - Static preset (rs2024-preset-top3.json) for fast initial load
   - Dynamic API (/api/sankey) for flexible exploration
   - In-memory caching of large JSON to avoid repeated disk reads

2. **Data Decompression Strategy**
   - Gzip compression reduces repo size (110MB → 5.9MB)
   - Decompression at build time (prebuild hook)
   - Allows full data availability without Git size issues

3. **URL State Management**
   - Enables shareable/bookmarkable views
   - Browser history works naturally
   - Single source of truth (React state + URL)

4. **5-Column Sankey Design**
   - Budget Budget Budget → Spending Spending
   - Green (budget) vs Red (spending) color scheme
   - Shows full flow from allocation to execution

5. **TopN Aggregation**
   - Reduces diagram complexity
   - "Other" nodes allow drilling into less-visible data
   - Configurable per view

### Potential Extensions

- Budget drilldown by account category (一般会計 vs 特別会計)
- Multi-year comparison (historical data available)
- Spending rate analysis (execution vs budget)
- Export capabilities (CSV, PDF)
- Search functionality across projects/recipients

---

## 10. Important Files & Their Roles

### Core Logic Files

| File | Lines | Purpose |
|------|-------|---------|
| app/sankey/page.tsx | 859 | Main UI, state management, interactions |
| app/lib/sankey-generator.ts | 936 | Dynamic Sankey generation algorithm |
| scripts/generate-preset-json.ts | 560+ | Top3 preset generation |
| scripts/generate-structured-json.ts | 600+ | Full structured JSON from CSV |
| scripts/normalize_csv.py | 200+ | CSV text normalization |

### Type Definition Files

| File | Purpose |
|------|---------|
| types/structured.ts | Full data model (187 lines) |
| types/preset.ts | Sankey visualization types (109 lines) |
| types/rs-system.ts | Original CSV structure types |

### Data Files

| File | Size | Purpose |
|------|------|---------|
| public/data/rs2024-structured.json.gz | 5.9MB | Compressed full data (in Git) |
| public/data/rs2024-structured.json | 46MB | Uncompressed full data (build output) |
| public/data/rs2024-preset-top3.json | 32KB | Pre-generated Top3 preset |

---

## 11. Development Workflow

### Common Tasks

```bash
# Update source data
npm run normalize                 # After RS System CSV update
npm run generate-structured       # Regenerate full structure
npm run generate-preset           # Regenerate Top3 preset
npm run compress-data             # Gzip for Git storage
git add public/data/rs2024-structured.json.gz
git commit -m "Update data"
git push                          # Auto-deploy to Vercel

# Development
npm run dev                       # Start dev server
# Edit components in app/sankey/page.tsx or app/lib/sankey-generator.ts
# Hot reload applies changes automatically

# Debug
# - Open DevTools → Network to see /api/sankey requests
# - Check server logs for data loading errors
# - Verify rs2024-structured.json exists and is readable
```

### Troubleshooting

**Data Load Fails (404)**:
- Check that `npm run build` was completed successfully
- Verify decompress-data.sh executed (check .gz file timestamp)

**"neologdn not installed"**:
- Run: `pip3 install neologdn`

**ZIP Files Not Found**:
- Download from https://rssystem.go.jp/download-csv/2024
- Place in data/download/RS_2024/

**TypeScript Errors**:
- Ensure all CSV rows match type definitions in types/rs-system.ts
- Check that normalized CSV headers match expected field names

---

## 12. Performance Characteristics

**Load Times**:
- Initial page load: ~100-200ms (small HTML + CSS)
- First Sankey render: ~500-1000ms (fetch from API + render)
- API response: ~50-100ms (in-memory JSON operations)
- Sankey re-render on navigation: ~300-500ms

**Memory Usage**:
- Server: ~200MB (cached structured JSON)
- Client: ~50-100MB (Sankey rendering + state)

**Data Structure Sizes**:
- Full structured JSON: 46MB (15,111 projects + 25,892 recipients)
- Preset Top3: 32KB
- Sankey diagram (Max): ~2000 nodes, ~3000 links

**Optimization Opportunities**:
- Lazy load spendings data (load on demand)
- Virtual scrolling for large lists (if UI expanded)
- WebAssembly for JSON parsing (if data grows significantly)

---

## Quick Reference: Key Classes & Interfaces

### Data Interfaces
- **RS2024StructuredData**: Full data model (metadata, budgetTree, budgets, spendings, statistics)
- **BudgetRecord**: Individual project budget (7-level hierarchy + amounts)
- **SpendingRecord**: Spending recipient org (corporate info + project links)
- **BudgetTree**: Hierarchical ministry structure (Ministry → Section)

### Visualization Interfaces
- **RS2024PresetData**: Sankey data + metadata (for API response)
- **SankeyNode**: 5-column node types (ministry-budget, project-budget, etc.)
- **SankeyLink**: Connection with amount value

### State Management
- **GenerateOptions**: API request parameters
- **DataSelection**: Intermediate data selection result
- **ViewMode**: 'global' | 'ministry' | 'project' | 'spending'

---

This document should provide future Claude instances with complete understanding of the system's architecture, data flow, and implementation details.
