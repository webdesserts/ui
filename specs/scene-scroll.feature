Feature: Scene Scroll
  When focused content exceeds the available viewport space, the
  Scene provides native scrolling. One scrollbar covers the entire
  focused area per axis. Scroll bounds are clamped to the focused
  content. Consumers can add internal scrollbars to individual
  SceneObjects for independent scroll behavior.

  Background:
    Given the Scene is inside a container with defined width and height

  # --- Scrollbar Visibility ---

  Scenario: No scrollbar when content fits
    Given all focused content fits within the viewport
    Then no scrollbar should be visible

  Scenario: Vertical scrollbar only
    Given focused content is taller than the viewport but fits the width
    Then a vertical scrollbar should appear on the right edge
    And no horizontal scrollbar should appear

  Scenario: Horizontal scrollbar only
    Given focused content is wider than the viewport but fits the height
    Then a horizontal scrollbar should appear on the bottom edge
    And no vertical scrollbar should appear

  Scenario: Both scrollbars
    Given focused content exceeds the viewport in both dimensions
    Then both vertical and horizontal scrollbars should appear

  Scenario: Scrollbar disappears on focus change to smaller content
    Given a vertical scrollbar is visible
    When focus changes to content that fits the viewport
    Then the scrollbar should disappear

  # --- Scroll Bounds ---

  Scenario: Vertical scroll range matches focused bounds
    Given focused content is taller than the viewport
    Then scrolling to the top should show the top edge of the topmost focused object
    And scrolling to the bottom should show the bottom edge of the bottommost
    And further scrolling should not be possible

  Scenario: Horizontal scroll range matches focused bounds
    Given focused content is wider than the viewport
    Then scrolling left should show the left edge of the leftmost focused object
    And scrolling right should show the right edge of the rightmost

  Scenario: Scroll bounds include padding
    Given padding of 16px and focused content taller than the viewport
    Then the scroll range should include 16px above and below the content

  Scenario: Padding can push content into overflow
    Given focused content that fits the viewport without padding
    And the Scene has padding that causes the total bounds to exceed the viewport
    Then the content should be treated as overflowing
    And the appropriate scrollbar should appear

  # --- Scroll Reset ---

  Scenario: Focus change resets scroll to top-left
    Given the user has scrolled partway through focused content
    When focus changes to a different object
    Then the scroll should reset to the top-left of the new content

  Scenario: Focus change during active scroll
    Given the user is actively scrolling
    When focus changes
    Then scrolling should stop and reset to the new target

  # --- Alignment & Centering ---

  Scenario: Content fits both axes — centered
    Given focused content is smaller than the viewport in both dimensions
    Then the content should be centered horizontally and vertically

  Scenario: Overflows vertically only — centered horizontally, top-aligned
    Given focused content fits the width but overflows the height
    Then the content should be centered horizontally
    And the top edge of the content should be at the top of the viewport

  Scenario: Overflows horizontally only — left-aligned, centered vertically
    Given focused content overflows the width but fits the height
    Then the left edge of the content should be at the left of the viewport
    And the content should be centered vertically

  Scenario: Overflows both axes — top-left corner visible
    Given focused content overflows both dimensions
    Then the top-left corner of the content should be at the top-left of the viewport

  Scenario: Alignment updates on viewport resize — fit to overflow
    Given focused content is centered because it fits
    When the viewport shrinks so the content overflows horizontally
    Then the content should anchor to the left edge
    And a horizontal scrollbar should appear

  Scenario: Alignment updates on viewport resize — overflow to fit
    Given focused content overflows with a scrollbar visible
    When the viewport grows so the content fits
    Then the content should become centered
    And the scrollbar should disappear

  # --- Unfocused Objects During Scroll ---

  Scenario: Unfocused objects stay pinned during vertical scroll
    Given focused content is vertically scrollable
    And unfocused objects are visible in the background
    When the user scrolls vertically
    Then the unfocused objects should not move

  Scenario: Unfocused objects stay pinned during horizontal scroll
    Given focused content is horizontally scrollable
    And unfocused objects are visible in the background
    When the user scrolls horizontally
    Then the unfocused objects should not move

  # --- Viewport Resize ---

  Scenario: Viewport resize while scrolled
    Given the user is scrolled partway through tall focused content
    When the viewport height grows
    Then the scroll position should remain valid
    And if the content now fits, the scrollbar should disappear

  # --- Consumer Scroll Override ---

  Scenario: Consumer adds internal scroll to a SceneObject
    Given a focused SceneObject with overflow-y: auto and height of 100%
    Then the SceneObject should scroll its content internally
    And no Scene-level vertical scrollbar should appear
