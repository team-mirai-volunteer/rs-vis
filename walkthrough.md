# Top View Visualization Fix and Optimization

## Problem
The user reported that the "Top View" failed when trying to show "All Ministries".
1.  **Flow Discontinuity**: "All Ministries" were shown, but "Other Projects" were missing, causing dead-end nodes.
2.  **Node Clutter**: Enabling "Other Projects" per ministry created too many nodes (~74 extra nodes), making the diagram unreadable.
3.  **Duplicate Keys**: A bug was introduced where recipient nodes were added twice, causing React rendering errors.

## Solution
We modified `sankey-generator.ts` to implement a **Global Aggregation Strategy** for the Global View:

1.  **Global "Other Projects" Node**:
    - Instead of creating an "Other Projects" node for *each* ministry, we create a **single** `project-budget-other-global` node.
    - All ministries link their remaining budget (not used by Top Projects) to this single node.
    - This reduces "Other Projects" nodes from ~37 to 1.

2.  **Global "Other Recipients" Node**:
    - Similarly, we create a **single** `recipient-other-aggregated` node.
    - The `project-spending-other-global` node links to this.
    - Any remaining spending from Top Projects (that didn't go to Top Recipients) also links to this.

3.  **Updated Defaults**:
    - Default "Top N Payees" set to 5.

4.  **Bug Fix**:
    - Removed redundant `nodes.push(...recipientNodes)` call that was causing duplicate keys.

## Node Structure (Global View)
The resulting Sankey diagram now follows this clean structure:
- **Layer 1**: Total Budget (1 node)
- **Layer 2**: All Ministries (37 nodes)
- **Layer 3**: 
    - Top Projects (~5 nodes)
    - Other Projects (1 aggregated node)
- **Layer 4**:
    - Top Projects Spending (~5 nodes)
    - Other Projects Spending (1 aggregated node)
- **Layer 5**:
    - Top Recipients (5 nodes)
    - Other Recipients (1 aggregated node)

## Changes

### `app/lib/sankey-generator.ts`
- **`buildSankeyData`**:
    - Added `isGlobalView` check.
    - Implemented logic to aggregate "Other Projects" budget and spending across all ministries when in Global View.
    - Implemented logic to aggregate "Other Recipients" flow from the global "Other Projects" node and Top Projects remainders.
    - Fixed duplicate node insertion bug.

### `app/api/sankey/route.ts` & `app/sankey/page.tsx`
- Default `spendingLimit` (Top N) updated to 5.

## Result
The visualization now meets the user's requirement for a concise "Top View" that shows the flow from the entire budget down to the specific Top N recipients, without overwhelming the user with hundreds of minor nodes.
