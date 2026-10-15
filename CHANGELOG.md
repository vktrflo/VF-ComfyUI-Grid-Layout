# Changelog

All notable changes to **VF Grid Layout** (`vf-comfyui-grid-layout`) are documented in this file.

## [1.1.1] - 2026-10-14

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
