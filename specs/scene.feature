Feature: Scene
  A 2D spatial navigation system. SceneObjects live in SceneColumns.
  The scene is a horizontal row of columns in DOM order, each sized
  to fit their content by default (consumer can override via CSS).
  All columns are always present and visible — the scene is a real
  space, not a set of hidden panels.

  The Scene is a spatial layout, not a scroll view. Columns and
  objects exist in a 2D space — they are placed in the scene, not
  inside a clipping container. The Camera is the visible window
  into that space. Content outside the Camera's view (offscreen
  columns, stacked deck columns, content above or below during
  scroll) still exists in the scene, it is simply off-camera.

  When columns are focused, they participate in a responsive flex
  layout filling the viewport. Unfocused columns are positioned
  by the Scene: outer columns slide offscreen, in-between columns
  stack as a depth deck behind the nearest focused column.

  # --- Initial Layout ---

  Scenario: All columns are visible on initial render
    Given a Scene with three columns, none focused
    Then all three columns should be laid out in a horizontal row
    And each column should be sized to fit its content
    And columns should be aligned to the top (flex-start)

  Scenario: Column size is based on content by default
    Given a SceneColumn containing a 400px wide element
    Then the column should be 400px wide
    And adjacent columns should position relative to that width

  Scenario: Consumer can override column sizing via CSS
    Given a SceneColumn with a className that sets width to 50vw
    Then the column should be 50vw wide regardless of content size

  Scenario: First focus animates from initial position
    Given a Scene with all columns visible but none focused
    When one column becomes focused
    Then it should animate from its initial position into the focused flex layout
    And unfocused columns should animate to their offscreen/stacked positions

  # --- Focus ---

  Scenario: Single focused object
    Given a Scene with one focused SceneObject that is 300px × 200px
    Then the Camera viewport should encompass at least 300px × 200px
    And the focused object should be fully visible

  Scenario: Multiple focused objects in separate columns
    Given a Scene with two focused SceneObjects in separate columns
    Then the Camera viewport should encompass both objects
    And both should be fully visible

  Scenario: Multiple columns can be focused simultaneously
    Given a Scene with Navigation, Article, and Chat columns
    When Navigation and Chat are both focused
    Then both columns should participate in the horizontal flex layout
    And the Article column should be treated as unfocused

  Scenario: If everything goes unfocused the camera doesn't move
    Given a Scene where objects were previously focused
    When all objects become unfocused
    Then the Camera should stay at its last position

  Scenario: Focused object unmounts
    Given two focused SceneObjects
    When one unmounts
    Then the Camera should reframe to the remaining focused object

  Scenario: Focus changes
    Given two focused SceneObjects
    When one becomes unfocused
    Then the Camera should animate to frame only the remaining focused object

  # --- Unfocused Objects ---

  Scenario: Unfocused objects remain in the DOM
    Given focused and unfocused objects
    Then unfocused objects should still be rendered in the DOM

  Scenario: Outer unfocused columns slide offscreen
    Given focused columns in the center of the Scene
    And unfocused columns to the left of the leftmost focused column
    And unfocused columns to the right of the rightmost focused column
    Then outer-left unfocused columns should be positioned offscreen to the left
    And outer-right unfocused columns should be positioned offscreen to the right

  Scenario: In-between unfocused columns stack as a depth deck
    Given two focused columns with one unfocused column between them
    Then the unfocused column should be positioned under the right focused column
    And it should peek out to the left to indicate its presence
    And it should be scaled down slightly to appear farther back in the scene

  Scenario: Multiple in-between columns stack with increasing depth
    Given two focused columns with three unfocused columns between them
    Then all three unfocused columns should be positioned under the right focused column
    And each successive column deeper in the stack should be scaled down further
    And each should peek out slightly more to the left

  Scenario: Stacking animation — columns picked up and set down
    Given an unfocused column transitioning from outer to in-between position
    When the column needs to move into the depth stack
    Then it should animate as if picked up from the right
    And set down on top of the column to its left
    Repeating until it is adjacent to the left focused column

  Scenario: Unfocused objects freeze at their last size
    Given a focused SceneObject at 400px wide
    When it becomes unfocused
    Then it should remain 400px wide
    And it should not resize in response to layout changes

  Scenario: Re-focusing animates from frozen size
    Given an unfocused SceneObject frozen at 200px wide
    When it becomes focused in a 1000px viewport alongside a flexible sibling
    Then it should spring-animate from 200px to its new flex-assigned width

  # --- Unfocused Visual Treatment ---

  # The Scene applies all stacking visual treatment to unfocused objects.
  # Consumers can override appearance via className, but the Scene owns
  # the default: position, z-index, depth (z-transform), opacity, and
  # greyscale — each scaled by stack depth.

  Scenario: Scene applies stacking visuals to unfocused columns
    Given a Scene with focused and unfocused columns
    Then the Scene should apply position, z-index, and z-transform to unfocused columns
    And unfocused columns deeper in the stack should have lower opacity and more greyscale
    Without any consumer configuration

  Scenario: Stacking depth scales opacity and greyscale
    Given three unfocused columns stacked at depths 1, 2, and 3
    Then the depth-1 column should have the highest opacity and least greyscale
    And the depth-3 column should have the lowest opacity and most greyscale

  Scenario: Consumer can override stacking visuals via className
    Given a Scene with unfocused columns
    When the consumer applies a custom className to a SceneObject
    Then the consumer's styles can override the Scene's default stacking treatment

  # --- Unfocused Interactivity ---

  Scenario: Clicking an unfocused object refocuses it
    Given an unfocused SceneObject
    When the user clicks anywhere on it
    Then it should become focused
    Because the SceneObject wrapper remains clickable even when its content is inert

  Scenario: Unfocused object internals are not interactive
    Given an unfocused SceneObject containing buttons and form inputs
    Then those buttons and inputs should not be clickable or focusable
    Because the content inside the SceneObject is marked as inert
    But the SceneObject wrapper itself remains interactive for click-to-focus

  # --- Focused Content Stability ---

  # Focused content is the anchor point. Unfocused objects appearing
  # or disappearing should not shift what the user is looking at.
  # Exception: content to the LEFT may shift focused content when
  # removed, because left-to-right order determines scene position.
  # This is an accepted tradeoff for maintaining navigation context.

  Scenario: Unfocused content unmounting to the right does not shift focus
    Given focused content in the viewport
    And unfocused content to the right
    When the consumer unmounts the unfocused content
    Then the focused content should not move

  Scenario: Unfocused content unmounting above does not shift focus
    Given focused content in the viewport
    And unfocused content above
    When the consumer unmounts the unfocused content
    Then the focused content should not move

  Scenario: Unfocused content unmounting below does not shift focus
    Given focused content in the viewport
    And unfocused content below
    When the consumer unmounts the unfocused content
    Then the focused content should not move

  Scenario: Unfocused content unmounting to the left may shift focus
    Given focused content in the viewport
    And unfocused content to the left
    When the consumer unmounts the unfocused content
    Then the focused content may shift leftward
    Because left-to-right order determines scene position

  # --- Focused Flex Layout ---

  Scenario: Focused objects share available width via consumer CSS
    Given a 1000px wide viewport
    And two focused SceneObjects in separate columns, each sized with cqw units
    Then both should share the 1000px width
    Note: columns are content-sized by default. Sharing is opt-in via consumer
    CSS (cqw units, explicit widths, or calc expressions)

  Scenario: Focused object with max-width
    Given a 1000px wide viewport
    And one focused SceneObject with max-width of 600px
    Then the object should render at 600px
    And it should be centered within the viewport

  Scenario: Adding focus reshapes the layout
    Given one focused object filling the viewport
    When a second object in another column becomes focused
    Then the first should shrink to share space
    And the second should appear in the layout

  Scenario: Removing focus lets siblings expand
    Given two focused objects sharing the viewport
    When one becomes unfocused
    Then the remaining should expand to fill the viewport
    And the unfocused one should freeze at its current width

  Scenario: Consumer CSS changes cause layout reflow
    Given a focused SceneObject with max-width of 70ch
    When the consumer changes its max-width to 100%
    Then the layout should reflow to accommodate the new size

  # --- Sizing: Two Axes Independently ---

  Scenario: Flexible width, scrollable height (Article pattern)
    Given a focused SceneObject with flexible width and tall content
    And the viewport is 800px wide and 600px tall
    Then the object should fill the 800px width
    And the column should be vertically scrollable

  Scenario: Fixed width, fixed height (DataTable pattern)
    Given a focused SceneObject at 1200px wide and 2000px tall
    And the viewport is 800px × 600px
    Then the object should maintain 1200px × 2000px
    And the scene should be horizontally scrollable (camera movement)
    And the column should be vertically scrollable (column movement)

  Scenario: Flexible width, flexible height (Small panel pattern)
    Given a focused SceneObject with flexible sizing and small content
    And the viewport is larger than the content in both axes
    Then the object should be centered in the viewport

  Scenario: Mixed sizing in the same layout
    Given a fixed-width SceneObject (400px) and a flexible SceneObject
    And both are focused in a 1000px viewport
    Then the fixed object should be 400px
    And the flexible object should fill the remaining 600px

  # --- Gaps ---

  # Gaps are configurable at two levels: between columns (scene-level)
  # and between objects within a column (column-level). Gaps can have
  # a min/max range and stretch based on available space.

  Scenario: Configurable gap between focused columns
    Given a Scene with a column gap configured
    Then focused columns should have that gap between them
    And the gap should stretch based on available space within its min/max range

  Scenario: Configurable gap between objects in a column
    Given a SceneColumn with a gap configured between objects
    Then focused objects within the column should have that gap between them
    And the gap should stretch based on available space within its min/max range

  Scenario: Default gap is zero
    Given no gap configured at either level
    Then focused columns should be adjacent with no gap
    And objects within a column should be adjacent with no gap

  # --- Padding ---

  Scenario: Padding adds space around focused bounds
    Given a Scene with padding of 16px and one focused SceneObject
    Then there should be 16px of space between the object and the viewport edges

  Scenario: Default padding is zero
    Given a Scene with no padding specified
    Then there should be no extra space around focused objects

  # --- Spring Physics ---

  Scenario: Mid-animation re-targeting
    Given the Camera is animating toward one object
    When focus switches to a different object before the animation completes
    Then the Camera should smoothly redirect and settle on the new target

  Scenario: Rapid sequential focus changes
    Given focus changes three or more times in quick succession
    Then the Camera should settle on the final target
    And should not exhibit erratic behavior

  Scenario: Initial mount animation
    Given a Scene is first rendered with a focused object
    Then the Camera should animate from a zero-size state to the focused object
    And the animation should use the same spring physics as focus changes

  Scenario: Reduced motion disables all spring animations
    Given the user prefers reduced motion
    When any animation would occur (initial mount, focus change, layout reflow, column swap)
    Then all transitions should be instant
    And no intermediate animation frames should be visible

  # --- Dynamic Objects ---

  Scenario: SceneObject mounts while Scene is active
    Given a Scene with one focused object
    When a new focused SceneObject mounts
    Then the Camera should reframe to include both

  Scenario: Focused SceneObject unmounts
    Given two focused SceneObjects
    When one unmounts
    Then the Camera should reframe to the remaining one

  Scenario: Focused SceneObject resizes
    Given a focused SceneObject
    When its content causes it to change size
    Then the Camera should reframe to the new bounds

  # --- Accessibility ---

  Scenario: Unfocused objects are inert for assistive technology
    Given unfocused SceneObjects
    Then they should be marked as inert
    So screen readers do not announce content the user cannot see

  Scenario: Focus change moves keyboard focus to new content
    Given a user interacting with keyboard
    When focus changes to a different SceneObject
    Then keyboard focus should move to the first focusable element
      in the newly focused content

  # --- useCamera Hook ---

  Scenario: useCamera reports target bounds
    Given a Scene with a focused object at known dimensions
    Then useCamera should return the viewport bounds
    Including the focused object dimensions plus padding

  Scenario: useCamera reports transitioning during animation
    Given a focus change triggers a Camera animation
    Then useCamera should report transitioning as true
    When the animation completes
    Then useCamera should report transitioning as false
