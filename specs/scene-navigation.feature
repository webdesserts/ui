Feature: Scene Navigation
  Content is organized in SceneColumns. A column is a container
  with its own width — adjacent columns position relative to the
  column boundary, not individual objects within it. Objects
  within a column fill the column width by default, but the
  consumer controls object sizing via CSS (alignment, stretch,
  max-width, etc.).

  Columns participate in the Scene's horizontal flex layout.
  Navigation deeper goes right, back goes left.

  Unfocused columns are positioned by the Scene based on their
  relation to focused columns: outer columns are parked in place
  at their frozen size, visible only if the Camera's framing
  leaves room for them; in-between columns stack as a depth deck
  behind the right focused column.

  Within a column, the same stacking behavior applies: unfocused
  objects between two focused objects stack as a depth deck behind
  the lower focused object.

  # --- Columns ---

  Scenario: Column is a container with its own width
    Given a SceneColumn with a focused object narrower than the column
    Then the column should maintain its width
    And adjacent columns should position relative to the column boundary

  Scenario: Objects fill column width by default
    Given a SceneColumn with a focused object
    Then the object should fill the column's width by default
    And the consumer can override sizing via CSS (max-width, alignment, etc.)

  Scenario: Column displays one focused object
    Given a SceneColumn with two SceneObjects where the first is focused
    Then only the first object should be visible in that column's position

  Scenario: Vertical swap pushes the column to show the new object
    Given a SceneColumn with Object A focused and Object B unfocused
    When Object B becomes focused and Object A becomes unfocused
    Then the column should push vertically until Object B is visible
    And if Object B fits the viewport height, it should be centered vertically
    And if Object B is taller than the viewport, it should be top-aligned
    And the column's horizontal position should not change
    Note: this describes the newly-focused object's visual alignment within
    the viewport. Scroll-position reset on swap is specified in
    scene-scroll.feature.

  Scenario: Vertical swap direction follows DOM order
    Given a SceneColumn where Object A is before Object B in DOM order
    When focus changes from Object A to Object B
    Then the column should push upward (B rises into view)
    When focus changes from Object B back to Object A
    Then the column should push downward (A descends into view)

  Scenario: Sibling columns unaffected by vertical swaps
    Given two SceneColumns side by side, each with a focused object
    When the first column swaps to a different focused object
    Then the second column's object should not move

  Scenario: Multiple focused objects in a column stack vertically
    Given a SceneColumn with two adjacent focused SceneObjects
    Then both should be visible, stacked vertically within the column

  # A deck card peeks out in the direction it will travel when pulled
  # out of the deck. Within-column object decks anchor under the lower
  # focused sibling and peek up, as explicit per-depth offsets (a
  # configurable peekOffset, ~12px per depth level by default), fanned
  # so every deeper card's edge stays visible.

  Scenario: Unfocused objects between focused objects stack as depth deck
    Given a SceneColumn with Object A (focused), Object B (unfocused), Object C (focused)
    Then Object B should be positioned under Object C (the lower focused object)
    And it should peek out above by its configured peekOffset (~12px) and be scaled down for depth
    With the same visual treatment as column-level stacking
    And the gap between Object A and Object C should be configurable

  Scenario: Multiple unfocused objects between focused objects stack with depth
    Given a SceneColumn with Object A (focused), Objects B and C (unfocused), Object D (focused)
    Then B and C should be positioned under Object D
    Each scaled down further and peeking out an additional peekOffset increment
      (~12px per depth level) to show increasing depth

  Scenario: Vertical extension becomes one scrollable column
    Given a SceneColumn with two adjacent focused SceneObjects
    And their combined height exceeds the viewport
    Then the column should move vertically as one continuous unit
    And there should not be a separate scrollbar per object

  Scenario: Unfocusing an extended object shrinks the column
    Given a SceneColumn with two focused objects stacked vertically
    When one becomes unfocused
    Then the column should animate to show only the remaining focused object
    And the vertical scroll range should update accordingly

  Scenario: Column with no focused objects
    Given a SceneColumn where all objects are unfocused
    Then the column should not participate in the focused flex layout
    And its objects should remain at their last sizes

  # --- Horizontal Navigation ---

  Scenario: Focused columns share viewport width via consumer CSS
    Given three SceneColumns each with a focused object in a 1200px viewport
    And each column sized with cqw units
    Then all three columns should share the 1200px width
    Note: columns are content-sized by default; sharing the viewport width
    is opt-in via consumer CSS (see scene.feature)

  Scenario: Outer unfocused column is parked, Article expands
    Given Navigation and Article columns both focused
    When Navigation becomes unfocused and is to the left of the leftmost focused column
    Then Navigation should be parked at its frozen size to the left, off-camera
      if the Camera's framing leaves no room for it
    And Article should expand to fill the viewport

  Scenario: In-between unfocused column stacks as depth deck
    Given Column A (focused), Column B (unfocused), and Column C (focused)
    Then Column B should be positioned under Column C (the right focused column)
    And it should peek out to the left by its configured peekOffset (~12px), scaled down for depth
    And the gap between Column A and Column C should be configurable at the scene level

  # Not yet shipped — the current implementation moves a column directly
  # to its deck position with a single spring, not a picked-up/set-down
  # sequence.
  @future
  Scenario: In-between stacking animation sequence
    Given an unfocused column that needs to move into a depth stack
    Then the column should animate as if picked up from the right
    And travel left, being set down on the column to its left
    Repeating until all in-between columns are stacked under the right focused column

  Scenario: Refocusing a parked column slides it back into view
    Given Navigation is unfocused and parked off-camera to the left
    When Navigation becomes focused
    Then it should animate from its frozen size back into the viewport
    And the other focused content should shrink to make room

  # --- Depth Navigation ---

  Scenario: New column appears from the right
    Given focused content in Column 1
    When a new Column 2 appears to the right with a focused object
    Then Column 2 should animate in from the right
    And the Camera should reframe to include both columns

  Scenario: Navigating back reveals content from the left
    Given Column 1 is unfocused, parked to the left, and Column 2 is focused
    When Column 2 becomes unfocused and Column 1 becomes focused
    Then Column 1 should animate back into view from the left
    And Column 2 should remain at its last size, parked to the right — visible
      only if the Camera's framing leaves room for it

  Scenario: Column removed to the right does not shift focused content
    Given focused content in Column 1 and unfocused Column 2 to the right
    When the consumer unmounts Column 2
    Then Column 1's focused content should not move

  # --- Replacement / Layering ---

  Scenario: Replacing content within a column
    Given a SceneColumn with Object A focused
    When Object B mounts in the same column and becomes focused
    And Object A becomes unfocused
    Then Object B should animate into the column's position
    And Object A should transition to its frozen unfocused state

  # --- Responsive Sizing ---

  Scenario: Fixed and flexible columns coexist
    Given a 1200px viewport
    And a Navigation column (200px fixed) and Article column (flexible)
    Then Navigation should be 200px and Article should fill the remaining 1000px

  Scenario: Focusing a new column reshapes siblings
    Given Navigation and Article filling the viewport
    When a TableOfContents column becomes focused
    Then Article should shrink to make room for TableOfContents

  Scenario: Max-width on flexible content in wide viewport
    Given a flexible Article column with max-width of 70ch
    And a wide viewport
    Then Article should render at 70ch
    And the focused columns should be centered with equal space on both sides

  Scenario: Very narrow viewport
    Given three focused columns sized with cqw units in a 320px viewport
    Then columns should compress to share the 320px
    And if any column hits its min-width, horizontal scrolling should appear
    Note: this assumes viewport-sharing sizing (see "Focused columns share
    viewport width via consumer CSS"); content-sized columns overflow instead
    of compressing

  # Nested Scenes are not supported. The vertical column and
  # multi-focus layout should cover all known use cases.
