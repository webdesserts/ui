Feature: Scene Debug Mode
  When debug mode is enabled, the Scene renders visual overlays
  to help diagnose layout, focus, scroll, and stacking issues.

  # WIP — Debug specifics depend on the final implementation.
  # These scenarios describe the intent; exact overlay details
  # will be refined once the architecture is chosen.

  # --- Outlines ---

  Scenario: Camera layers have colored outlines
    Given a Scene with debug enabled
    Then the Camera viewport should have a cyan outline
    And the Scene stage should have a magenta outline

  Scenario: SceneObjects have colored outlines
    Given a Scene with debug enabled
    Then focused SceneObjects should have a green outline with their name
    And unfocused SceneObjects should have a gray outline with their name

  Scenario: Scroll offset areas have colored outlines
    Given a Scene with debug enabled
    And at least one focused column is vertically scrollable
    Then each vertically scrollable column should have a yellow outline showing its scroll bounds
    And if horizontal content also overflows, the scene-level horizontal scroll area should have a yellow outline

  Scenario: Debug does not affect layout
    Given a Scene with debug enabled
    Then the layout should be identical to the same Scene without debug

  # --- Debug Overlay Panel ---

  Scenario: Overlay shows SceneObject state
    Given a Scene with debug enabled
    Then the debug overlay should list each SceneObject's name,
      focused state, and computed bounds

  Scenario: Overlay shows Camera state
    Given a Scene with debug enabled
    Then the debug overlay should show the Camera's target bounds
    And the current viewport dimensions

  Scenario: Overlay shows per-column vertical scroll state
    Given a Scene with debug enabled and at least one focused column
    Then the debug overlay should show each focused column's vertical scroll position,
      column content height, available viewport height, and whether it is scrollable

  Scenario: Overlay shows scene-level horizontal scroll state
    Given a Scene with debug enabled and horizontal overflow
    Then the debug overlay should show the horizontal scroll position,
      total focused content width, available viewport width, and scrollable state

  Scenario: Overlay shows stacking depth for unfocused columns
    Given a Scene with debug enabled and in-between unfocused columns
    Then the debug overlay should show each unfocused column's position classification
      (outer-left, in-between, outer-right) and its stacking depth index

  Scenario: Overlay warns about offsetParent issues
    Given a Scene with debug enabled
    And a SceneObject whose bounds cannot be correctly computed
      due to a wrapping positioned element
    Then the debug overlay should show a warning for that SceneObject

  # --- Toggle ---

  Scenario: Debug toggles cleanly
    When debug is enabled then outlines and overlay should appear
    When debug is disabled then they should disappear completely
