# Changelog

All notable changes to **VF Grid Layout** (`vf-comfyui-grid-layout`) are documented in this file.

## [1.2.0] - 2026-11-03

### Added
- **Directional drop previews**: Dragging a node over a grid shows a ghost preview of where it will land.
  - Left or right edge of a cell: inserts a new column next to that cell.
  - Just below a node: stacks the node below it in the same cell.
  - Further below the grid: adds a full-width row at the bottom.
- **Autohide toggle in the selection toolbox**: An eye button next to **Grid** turns autohide on or off. The node stays selected.
- **Floating cell controls**: In autohide mode, cell controls show as a small pill at the top-right corner of each cell.

### Changed
- New grids have autohide on by default. Empty grids stay visible until you drop a node in.
- The autohide item moved from the Grid context menu to the selection toolbox. The grid header button is unchanged.
- In autohide mode, cells no longer reserve space for a header bar. Nodes do not move when you select or deselect them.

### Fixed
- Nodes 2.0: nodes whose content grows past their saved size (for example Load Image previews) are now measured by their rendered height, so rows below them no longer overlap.
- Dragging the only node of the bottom row below the grid again reuses that row instead of leaving an empty row behind.

### Notes
- Saved grids that already have autohide on will lay out 26px shorter per cell when opened, because the header space is removed.
- Turning autohide on or off moves the nodes in that grid by 26px.

## [1.1.2] - 2026-10-14

### Added
- **VF Link Effects**: Animated connector styles and custom link rendering effects.
- **Hidden-link reveal**: Temporarily reveal hidden links when interacting with connected nodes or grids.
- **Title bar opacity & grid/drop-zone autohide**: Customize header opacity and automatically hide grid chrome or drop zones until hovered/active.
- **In-grid selection controls & branded selection menu**: Improved selection handling and branded context menu actions.

### Fixed
- Turn autohide off automatically on empty grids and prevent re-enabling it while empty.
- Preserve node width on drop and preserve column widths on horizontal split.
- Align node placement cursor and reduce detection aggressiveness when adding nodes near grid layout controls.
- Size columns to widest selected node when creating a grid from selection.
- Styled **Change Appearance** dialog to match VF browse modals.

## [1.1.0] - 2026-10-14

### Added
- **VF Link Effects**: Animated connector styles and custom link rendering effects.
- **Hidden-link reveal**: Temporarily reveal hidden links when interacting with connected nodes or grids.
- **Title bar opacity & grid/drop-zone autohide**: Customize header opacity and automatically hide grid chrome or drop zones until hovered/active.
- **In-grid selection controls & branded selection menu**: Improved selection handling and branded context menu actions.

### Fixed
- Preserve node width on drop and preserve column widths on horizontal split.
- Align node placement cursor and reduce detection aggressiveness when adding nodes near grid layout controls.
- Size columns to widest selected node when creating a grid from selection.
- Styled **Change Appearance** dialog to match VF browse modals.

## [1.0.1] - 2026-10-10

### Added
- Grid container minimize toggle with consolidated ports and bottom border restoration.
- Tabbed appearance dialog with **Grid Background** customization.

### Fixed
- Image size limit, minimize/collapse restore behavior, hidden-node hit detection, and overlay performance.

## [1.0.0] - 2026-10-08

### Added
- Initial ComfyUI Registry release of **VF Grid Layout** (`vf-comfyui-grid-layout`).
- Splittable canvas grid frames with drop-to-fit node stacks, cell fill height, frame locking, and customizable header styling.
