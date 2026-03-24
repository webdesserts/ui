Feature: Scene
  A 2D spatial navigation system. SceneObjects live in SceneColumns.
  Focused objects participate in a responsive flex layout filling
  the viewport. The Camera spring-animates to keep all focused
  objects fully visible within the viewport bounds (plus padding).

  # --- Focus ---

  Scenario: Single focused object
    Given a Scene with one focused SceneObject that is 300px × 200px
    Then the Camera viewport should encompass at least 300px × 200px
    And the focused object should be fully visible

  Scenario: Multiple focused objects in separate columns
    Given a Scene with two focused SceneObjects in separate columns
    Then the Camera viewport should encompass both objects
    And both should be fully visible

  Scenario: No objects focused — browse mode
    Given a Scene where objects were previously focused
    When all objects become unfocused
    Then the Camera should stay at its last position
    But the scroll range should expand to encompass the entire Scene
    So the user can scroll around and click an object to refocus it

  Scenario: Focused object unmounts
    Given two focused SceneObjects
    When one unmounts
    Then the Camera should reframe to the remaining focused object

  Scenario: Only focused object unmounts — enters browse mode
    Given one focused SceneObject
    When it unmounts and no other objects are focused
    Then the Camera should hold its last position
    But the scroll range should expand to the entire Scene
    And unfocused objects should be visible but receded
    And the user can scroll to find and click an object to refocus

  Scenario: Focus changes
    Given two focused SceneObjects
    When one becomes unfocused
    Then the Camera should animate to frame only the remaining focused object

  # --- Unfocused Objects ---

  Scenario: Unfocused objects remain in the DOM
    Given focused and unfocused objects
    Then unfocused objects should still be rendered in the DOM
    But they should be positioned outside the Camera's viewport bounds

  Scenario: Unfocused objects freeze at their last size
    Given a focused SceneObject at 400px wide
    When it becomes unfocused
    Then it should remain 400px wide
    And it should not resize in response to layout changes

  Scenario: Re-focusing animates from frozen size
    Given an unfocused SceneObject frozen at 200px wide
    When it becomes focused in a 1000px viewport alongside a flexible sibling
    Then it should spring-animate from 200px to its new flex-assigned width

  # --- Unfocused Interactivity ---

  Scenario: Clicking an unfocused object refocuses it
    Given an unfocused SceneObject visible in the background
    When the user clicks anywhere on it
    Then it should become focused

  Scenario: Unfocused object internals are not interactive
    Given an unfocused SceneObject containing buttons and form inputs
    Then those buttons and inputs should not be clickable or focusable
    And they should be marked as inert

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

  # --- Consumer controls visual treatment ---

  Scenario: Scene exposes focused state for consumer styling
    Given a Scene with focused and unfocused SceneObjects
    Then the Scene should expose each object's focused state
    And the consumer is responsible for visual treatment of unfocused objects
    Because the Scene has no opinion about opacity, grayscale, or depth

  # --- Focused Flex Layout ---

  Scenario: Focused objects share available width
    Given a 1000px wide viewport
    And two flexible SceneObjects focused in separate columns
    Then both should share the 1000px width

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
    And a vertical scrollbar should appear for the tall content

  Scenario: Fixed width, fixed height (DataTable pattern)
    Given a focused SceneObject at 1200px wide and 2000px tall
    And the viewport is 800px × 600px
    Then the object should maintain 1200px × 2000px
    And both horizontal and vertical scrollbars should appear

  Scenario: Flexible width, flexible height (Small panel pattern)
    Given a focused SceneObject with flexible sizing and small content
    And the viewport is larger than the content in both axes
    Then the object should be centered in the viewport

  Scenario: Mixed sizing in the same layout
    Given a fixed-width SceneObject (400px) and a flexible SceneObject
    And both are focused in a 1000px viewport
    Then the fixed object should be 400px
    And the flexible object should fill the remaining 600px

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
    When any animation would occur (focus change, layout reflow, column swap)
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
    Given unfocused SceneObjects outside the viewport
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
