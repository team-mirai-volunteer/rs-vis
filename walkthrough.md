# Dynamic Sankey Diagram Enhancements Walkthrough

## Overview
We have successfully transformed the static Sankey diagram into a fully dynamic, interactive visualization. The application now fetches data on-demand from the server, allowing for scalable exploration of the large budget dataset.

## Key Features

### 1. Dynamic Data Loading
- **API-Driven**: Data is no longer hardcoded. The `/api/sankey` endpoint generates Sankey data based on real-time parameters.
- **Performance**: The large source data is cached on the server, ensuring fast response times for subsequent requests.

### 2. Interactive Drill-Down & Navigation
- **"Other Ministries" Drill-Down**: Clicking the "その他の府省庁" (Other Ministries) node loads the next set of ministries (pagination).
- **Ministry View**: Clicking a specific ministry node (e.g., "デジタル庁") switches to a focused view of that ministry's projects and spendings.
- **Back Navigation**:
  - Clicking the **"予算総計" (Total Budget)** node acts as a "Back" button, taking you up one level (e.g., from Ministry View back to Global View, or to the previous page of ministries).
  - A **"Topへ戻る" (Go to Top)** button is available in the header to instantly reset to the initial view.

### 3. Configurable Display Settings
- **Settings Dialog**: Click the settings icon (⚙️) in the header to open the configuration dialog.
- **Customizable Limits**:
  - **TopN (Global)**: Control how many ministries are shown in the main view (default: 3).
  - **TopN (Ministry)**: Control how many projects and spendings are shown in the Ministry View (default: 5).

### 4. Visual Refinements
- **Clean UI**: Removed the magnifying glass icon from nodes for a cleaner look.
- **Tooltips**: Enhanced tooltips provide detailed budget and spending information.

## Verification Steps

1.  **Restart Development Server**:
    > [!IMPORTANT]
    > You may see `ENOENT` errors in your terminal. This is because a production build (`npm run build`) was run while the development server (`npm run dev`) was active.
    > **Please stop the running `npm run dev` process (Ctrl+C) and start it again.**

2.  **Test Global Navigation**:
    - Open the Sankey page.
    - Click "その他の府省庁" and verify that new ministries appear.
    - Click "予算総計" and verify it returns to the previous list.

3.  **Test Ministry View**:
    - Click on a specific ministry (e.g., "厚生労働省").
    - Verify the chart updates to show only that ministry's budget flow.
    - Verify the title changes to reflect the selected ministry.
    - Click "予算総計" to return to the global view.

4.  **Test Settings**:
    - Open the settings dialog.
    - Change "TopN (府省庁一覧)" to 5.
    - Save and verify that 5 ministries are now displayed.

## Next Steps
- Explore the data and adjust the default TopN values if needed.
- Consider adding more granular filters (e.g., by Account Category) in the future.
