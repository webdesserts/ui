Feature: Scene Debug Mode
  When debug mode is enabled, the Scene renders visual overlays
  to help diagnose layout, focus, and scroll issues.

  # --- Outlines ---

  Scenario: Camera layers have colored outlines
    Given a Scene with debug enabled
    Then the Camera viewport should have a cyan outline
    And the Scene stage should have a magenta outline

  Scenario: SceneObjects have colored outlines
    Given a Scene with debug enabled
    Then focused SceneObjects should have a green outline with their name
    And unfocused SceneObjects should have a gray outline with their name

  Scenario: Scroll offset area has a colored outline
    Given a scrollable Scene with debug enabled
    Then the scroll offset area should have a yellow outline

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

  Scenario: Overlay shows scroll state
    Given a scrollable Scene with debug enabled
    Then the debug overlay should show scroll position,
      content dimensions, available dimensions, and scrollable state

  Scenario: Overlay warns about offsetParent issues
    Given a Scene with debug enabled
    And a SceneObject whose bounds cannot be correctly computed
      due to a wrapping positioned element
    Then the debug overlay should show a warning for that SceneObject

  # --- Toggle ---

  Scenario: Debug toggles cleanly
    When debug is enabled then outlines and overlay should appear
    When debug is disabled then they should disappear completely
