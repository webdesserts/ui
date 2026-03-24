Feature: Scene Navigation
  Content is organized in SceneColumns. Objects within a column
  share a horizontal slot and swap vertically. Columns participate
  in the Scene's horizontal flex layout. Navigation deeper goes
  right, back goes left.

  # --- Columns ---

  Scenario: Column displays one focused object
    Given a SceneColumn with two SceneObjects where the first is focused
    Then only the first object should be visible in that column's position

  Scenario: Vertical swap within a column
    Given a SceneColumn with Object A focused and Object B unfocused
    When Object B becomes focused and Object A becomes unfocused
    Then Object A should slide out vertically
    And Object B should slide into the focused position
    And the column's horizontal position should not change

  Scenario: Vertical swap direction follows DOM order
    Given a SceneColumn where Object A is before Object B in DOM order
    When focus changes from Object A to Object B
    Then content should slide upward (B rises into view)
    When focus changes from Object B back to Object A
    Then content should slide downward (A descends into view)

  Scenario: Sibling columns unaffected by vertical swaps
    Given two SceneColumns side by side, each with a focused object
    When the first column swaps to a different focused object
    Then the second column's object should not move

  Scenario: Multiple focused objects in a column stack vertically
    Given a SceneColumn with two focused SceneObjects
    Then both should be visible, stacked vertically within the column

  Scenario: Vertical extension becomes one scrollable unit
    Given a SceneColumn with two focused SceneObjects
    And their combined height exceeds the viewport
    Then they should scroll together continuously as one unit
    And there should not be a separate scrollbar per object

  Scenario: Unfocusing an extended object shrinks the column
    Given a SceneColumn with two focused objects stacked vertically
    When one becomes unfocused
    Then the column should animate to show only the remaining focused object
    And the scroll range should update accordingly

  Scenario: Column with no focused objects
    Given a SceneColumn where all objects are unfocused
    Then the column should not participate in the focused flex layout
    And its objects should be frozen at their last sizes

  # --- Horizontal Navigation ---

  Scenario: Focused columns share viewport width
    Given three SceneColumns each with a focused object in a 1200px viewport
    Then all three columns should share the 1200px width

  Scenario: Unfocusing a column slides it off-viewport
    Given Navigation and Article columns both focused
    When Navigation becomes unfocused
    Then Navigation should slide outside the viewport to the left
    And Article should expand to fill the viewport

  Scenario: Refocusing a column slides it back
    Given Navigation was unfocused and outside the viewport
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
    Given Column 1 is unfocused to the left and Column 2 is focused
    When Column 2 becomes unfocused and Column 1 becomes focused
    Then Column 1 should animate back into view from the left
    And Column 2 should slide to the right outside the viewport

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
    And the remaining space should not be allocated to other focused columns

  Scenario: Very narrow viewport
    Given three focused columns in a 320px viewport
    Then columns should compress to share the 320px
    And if any column hits its min-width, horizontal scrolling should appear

  # --- Collapse Pattern ---

  Scenario: Object collapses from full-width to sidebar
    Given a Navigation SceneObject filling the viewport
    When the consumer changes Navigation's max-width to a narrow sidebar size
    And a new Page column becomes focused
    Then Navigation should animate to its new narrow width
    And Page should fill the remaining space

  # --- Composable / Nested Scenes ---

  Scenario: Nested Scene manages its own focus
    Given a parent Scene with a sidebar column and content column
    And the content column contains a nested Scene
    When focus changes inside the nested Scene
    Then only the nested Scene's Camera should animate
    And the parent Scene's layout should not change
