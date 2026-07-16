Feature: Scene Scroll
  Horizontal and vertical scroll have different mental models.

  Horizontal scroll moves the camera across a static scene. The
  entire scene slides left and right — all columns, focused and
  unfocused, move together. The user is panning a viewport over
  the full scene layout.

  Vertical scroll moves the column itself through the scene. The
  camera stays still while the column's content is pushed up or
  down. A column is one continuous strip with a single scroll
  state — SceneObjects within it may still own their own internal
  scrollbars (a consumer-managed overflow inside a SceneObject),
  but outside of those, there is exactly one scroll position per
  column. Each focused column scrolls independently based on its
  own content height. Non-overflowing focused columns stay
  centered; unfocused columns stay frozen.

  A column's scroll position is remembered while its internal
  focus arrangement is unchanged — parking the column and later
  refocusing it restores where it was scrolled. Any change to
  which objects are focused within the column (a vertical swap)
  resets the scroll position deterministically: it does not
  remember per-object positions. See "Scroll Position" below.

  Scrollbars are styled thin with a transparent track. Each
  focused column is visible as a whole as it slides through the
  viewport during scroll — content is clipped at the viewport
  boundary, not at individual column boundaries. This means
  decorative elements such as shadows and glows on focused content
  are not cut off at the column edge.

  Background:
    Given the Scene is inside a container with defined width and height

  # --- Scroll Models ---

  Scenario: Horizontal scroll moves the camera across the scene
    Given multiple focused columns whose combined width exceeds the viewport
    When the user scrolls horizontally
    Then the entire scene slides — all columns move together
    And the scroll range covers the total focused width minus the viewport width

  Scenario: Vertical scroll moves the column through the scene
    Given two focused columns where only one overflows the viewport height
    When the user scrolls vertically over the overflowing column
    Then that column's content is pushed upward through the scene
    And the camera stays still
    And the non-overflowing column stays centered vertically

  Scenario: Non-overflowing focused columns stay centered during vertical scroll
    Given a tall focused column and a short focused column side by side
    When the user scrolls vertically to see more of the tall column
    Then the short column should remain vertically centered in the viewport
    And it should not be displaced by the scroll
    Because only the overflowing column moves; the short column's centering is independent

  Scenario: Unfocused columns stay frozen during vertical scroll
    Given focused columns that are vertically scrollable
    And unfocused columns in the scene
    When the user scrolls vertically
    Then unfocused columns should not move vertically
    Because vertical scroll moves individual columns, not the scene
    Note: unfocused columns DO move during horizontal scroll (camera movement)

  # --- Scroll Interaction ---

  Scenario: Vertical scroll targets the column under the cursor when multiple are scrollable
    Given two focused columns that both overflow the viewport height
    When the user scrolls vertically with the cursor over the right column
    Then only the right column should scroll
    And the left column should stay at its current vertical position

  Scenario: Vertical scroll targets the only scrollable column regardless of cursor position
    Given exactly one focused column that overflows the viewport height
    And other focused columns that do not overflow
    When the user scrolls vertically anywhere in the Camera viewport
    Then the one scrollable column should scroll
    Note: under-cursor targeting (above) only applies when multiple focused
    columns are simultaneously scrollable; with only one, there's no
    ambiguity to resolve and no dead margins in the viewport

  Scenario: An interior scroll container consumes wheel input before the column claims it
    Given a focused SceneObject with its own overflow-y: auto scroll container
    When the user scrolls vertically with the cursor over that container
    Then the container should scroll itself natively
    And the Scene should not claim the wheel input for column routing
    Because a real, currently-scrollable interior container gets first
    refusal on the delta — only once it declines does the column-routing
    above apply, exactly as if nothing about the container's outer column
    were involved

  Scenario: Wheel input chains outward once the interior container reaches its scroll edge
    Given a focused SceneObject's interior scroll container, scrolled to its bottom edge
    When the user continues scrolling vertically in the same direction
    Then further wheel input should chain to the column's own scroll, like
    ordinary nested scroll containers outside a Scene
    But if the interior container declares overscroll-behavior: contain (or
    none), wheel input at its edge should dead-stop there instead — the
    consumer's own CSS says not to chain past this edge

  Scenario: Diagonal trackpad gesture scrolls both axes simultaneously
    Given a scene that overflows horizontally
    And a focused column that overflows vertically
    When the user performs a diagonal trackpad gesture
    Then the scene should pan horizontally and the column should scroll vertically at the same time

  Scenario: Horizontal panning preserves vertical scroll positions
    Given two focused columns each scrolled to different vertical positions
    When the user scrolls the scene horizontally
    Then each column should maintain its vertical scroll position

  # --- Scrollbar Visibility ---

  Scenario: No scrollbar when content fits
    Given all focused content fits within the viewport
    Then no scrollbar should be visible

  Scenario: Vertical scrollbar when a single focused column overflows height
    Given one focused column that is taller than the viewport
    Then a vertical scrollbar should appear at the right edge of the Camera
    And the scroll area should be the entire Camera viewport
    Note: see "Vertical scroll targets the only scrollable column regardless
    of cursor position" in Scroll Interaction — wheel input anywhere in the
    viewport reaches this column, not just when the cursor is over it

  Scenario: Each overflowing column gets its own vertical scrollbar
    Given two focused columns that both overflow the viewport height
    Then the rightmost column's scrollbar should appear at the right edge of the Camera
    And other columns' scrollbars should appear between adjacent focused columns
    And scrolling one column should not affect the other

  Scenario: Horizontal scrollbar when focused columns exceed viewport width
    Given the total width of focused columns exceeds the viewport
    Then a horizontal scrollbar should appear at the Camera viewport's bottom edge

  Scenario: Both scrollbars when content overflows both axes
    Given focused content exceeds the viewport in both dimensions
    Then horizontal and vertical scrollbars should both be present

  Scenario: Scrollbar disappears on focus change to smaller content
    Given a vertical scrollbar is visible
    When focus changes to content that fits the viewport
    Then the scrollbar should disappear

  # --- Scroll Bounds ---

  Scenario: Each column's vertical scroll range covers only its focused content
    Given two focused columns where the left is 2000px tall and the right is 800px tall
    And the viewport is 600px tall
    Then the left column's vertical scroll range should be 2000px − 600px
    And the right column's vertical scroll range should be 800px − 600px
    And each column scrolls independently

  Scenario: Unfocused objects in a column do not extend the scroll range
    Given a column with a focused article that is 2000px tall
    And an unfocused panel in the same column that is 500px tall
    And the viewport is 600px tall
    Then the column's vertical scroll range should be 2000px − 600px
    And the unfocused panel is visible in the scene but is not reachable by scrolling

  Scenario: Horizontal scroll range matches overflow
    Given focused columns whose total width is 2400px
    And the viewport is 1200px wide
    Then the horizontal scroll range should be 2400px − 1200px
    And scrolling right should reveal the right edge of the rightmost focused column

  Scenario: Scroll bounds include padding
    Given padding of 16px and focused content taller than the viewport
    Then the scroll range should include 16px above and below the content

  Scenario: Padding can push content into overflow
    Given focused content that fits the viewport without padding
    And the Scene has padding that causes the total bounds to exceed the viewport
    Then the content should be treated as overflowing
    And the appropriate scrollbar should appear

  # --- Scroll Position ---

  Scenario: Vertical scroll position restores when a column is refocused
    Given a focused column that was previously scrolled halfway down
    When the user focuses a different column and then returns focus to the
      first, with the same object focused within it throughout
    Then the column should attempt to restore its previous scroll position
    But if the focused object within the column is not visible at that position
    Then the column should adjust to show the focused object
    And if the column's content height has changed by 50% or more since it
      was last focused
    Then scrolling to the top of the focused content is the fallback

  Scenario: Horizontal scroll position resets when focus layout changes
    Given the user has scrolled the scene horizontally
    When focus changes to a different set of columns
    Then horizontal scroll should reset to show the left edge of the new focused layout

  Scenario: Vertical scroll resets when a column first becomes focused
    Given an unfocused column with no prior scroll position
    When it becomes focused
    Then its vertical scroll should start at the top

  Scenario: Vertical swap resets scroll to the newly-focused object
    Given Object A was previously scrolled halfway down and Object B was
      unfocused
    When focus swaps from Object A to Object B within the same column
    Then the column's scroll position should reset deterministically to show
      Object B from the top of its content by default
    And Object A's prior scroll position is not remembered for next time
    Because a vertical swap changes which object is focused; only the scroll
    position of an unchanged focus arrangement is remembered
    Note: the reset alignment is configurable per object (top by default,
    center as an opt-in — e.g. an image viewer)

  Scenario: Keyboard scroll targets the column with keyboard focus
    Given two focused columns that both overflow the viewport height
    And keyboard focus is inside the right column
    When the user presses Page Down
    Then the right column should scroll down
    And the left column should not move

  Scenario: An interior scroll container keeps its own arrow keys when it fills the column
    Given a focused SceneObject with its own overflow-y: auto scroll
    container that fills the whole column (the column itself has nothing
    left to scroll)
    And keyboard focus is inside that container
    When the user presses an arrow key
    Then the container should keep the key for its own native scrolling
    Because the column's own keyboard handler only intercepts scroll keys
    when the column itself has something to scroll

  Scenario: Focus change during active scroll
    Given the user is actively scrolling
    When focus changes
    Then scrolling should stop and the new target's scroll state should apply

  # --- Content-Driven Scroll (F9) ---

  # Mirrors native browser scroll anchoring: displacement corrections
  # driven by content changing size (not by the user's own scroll intent)
  # keep the user's in-view content visually stable, and apply instantly
  # rather than animating like an intent-driven scroll would.

  Scenario: Content growth or shrinkage above the scroll window is compensated invisibly
    Given a scrolled column with focused content above the current scroll window
    When that content's height changes (e.g. an image finishes loading, or
    an earlier object in a multi-object stack resizes)
    Then the column's scroll offset adjusts by the same delta in the same frame
    And the content the user was looking at does not visibly move
    Because this mirrors native browser scroll anchoring

  Scenario: Content growth below the scroll window does not move visible content
    Given a scrolled column with content below the current scroll window
    When that content's height changes
    Then the column's scroll offset is unaffected
    Because only growth above the visible window requires compensation

  Scenario: A follow-the-end column opens already at the newest content
    Given a column configured to follow the end (anchor="end")
    When it first becomes focused
    Then its scroll position starts at the bottom (maxScroll)
    Note: composes with the swap-reset model — anchor="end" overrides the
    default top-alignment on first focus and on a within-column swap

  Scenario: A follow-the-end column stays pinned while new content arrives
    Given a follow-the-end column scrolled to the bottom
    When new content is added
    Then the column's scroll offset moves to keep showing the bottom
    And the arrival of new content is not animated

  Scenario: Scrolling away from the end releases the follow-the-end pin
    Given a follow-the-end column pinned at the bottom
    When the user scrolls upward
    Then the pin releases
    And subsequent content arrivals no longer force the scroll position

  Scenario: Scrolling back to the end re-engages the follow-the-end pin
    Given a follow-the-end column with its pin released
    When the user scrolls back within a small threshold of the bottom
    Then the pin re-engages
    And subsequent content arrivals resume following the end
    Note: threshold is 2px, empirically measured — a real fractional wheel
    tick can land slightly short of the reported maxScroll (maxScroll
    resolves through offsetHeight, an integer; a wheel-driven offset stays
    exactly fractional)

  Scenario: Content-driven scroll changes jump; intent-driven scroll changes spring
    Given a focused, scrollable column
    When the user scrolls via wheel, keyboard, or touch
    Then the resulting scroll change animates with a spring
    But when scroll position adjusts due to content growth/shrinkage above
    the window, a follow-the-end pin keeping the offset at maxScroll, or a
    maxScroll shrink (viewport resize or content shrinking below the
    current offset)
    Then the resulting scroll change applies instantly, without animation
    Note: a column's `onScroll` prop, when provided, reports every one of
    these scroll changes — user-initiated and content-driven alike — as a
    `SceneScrollMetrics` snapshot (offset, maxScroll, contentHeight,
    viewportHeight, and whether the follow-the-end pin is currently
    engaged). It fires at the same per-tick cadence as the scroll offset
    itself, not once per React render.

  # --- Alignment & Centering ---

  # Each axis is handled independently. Centering on an axis only applies
  # when the content fits that axis. Overflow on an axis means the content
  # aligns to the start edge (top or left).

  Scenario: Content fits both axes — centered
    Given focused content is smaller than the viewport in both dimensions
    Then the content should be centered horizontally and vertically

  Scenario: Focused column overflows vertically — starts at top, centered horizontally
    Given a focused column is taller than the viewport but its width fits
    Then the column should initially show its top edge at the top of the viewport
    And the column should be centered horizontally

  Scenario: Focused columns overflow horizontally — both edges inset by padding, centered vertically
    Given focused columns together exceed the viewport width but their height fits
    Then the left edge of the leftmost column should be inset from the viewport's left edge by exactly the Scene's padding
    And, at maximum horizontal scroll, the right edge of the rightmost column should be inset from the viewport's right edge by exactly the Scene's padding
    And each column should be centered vertically
    # Both edges share the same inset — a mix (e.g. flush-left but
    # padding-inset-right) is never valid. At padding=0 both insets are 0
    # (flush/flush), matching the pre-existing left-aligned behavior.

  Scenario: Overflows both axes — top-left corner visible
    Given focused content overflows both dimensions
    Then the top-left corner of the focused content should be at the top-left of the viewport

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

  # --- Rendering Quality ---

  Scenario: Focused content renders crisply during and after scroll
    Given a focused column containing text and UI elements
    When the column is scrolled or comes to rest after scrolling
    Then text and UI elements in the focused column should appear sharp and clear
    And there should be no visual blurring or degradation of rendering quality

  # --- Viewport Resize ---

  Scenario: Viewport resize while scrolled
    Given the user is scrolled partway through tall focused content
    When the viewport height grows
    Then the scroll position should remain valid
    And if the content now fits, the scrollbar should disappear
    Note: if a resize instead SHRINKS the viewport below the current
    scroll offset, the resulting clamp correction applies instantly,
    without animation — see "Content-driven scroll changes jump" below
    (F9 adjudication 3)

  # --- Consumer Scroll Override ---

  Scenario: Consumer adds internal scroll to a SceneObject
    Given a focused SceneObject with internal scrolling sized via a
    container-query height unit (e.g. height: 100cqh)
    Then the SceneObject should scroll its content internally
    And no column-level vertical scrollbar should appear for that column
    Note: when a SceneObject handles its own internal scrolling, the column
    itself does not overflow, so no column-level scrollbar is needed
    Note: a literal height: 100% does NOT resolve here (probe-confirmed,
    F8c interior contract). CSS only resolves a descendant's percentage
    height against an ancestor whose OWN height is explicitly specified,
    not content-derived — and every ancestor up to the column's content
    wrapper is deliberately auto-height (the column measures its own
    content by observing that auto height). A min-height floor on the
    SceneObject's own wrapper does not help either — an ancestor's
    min-height does not make its "specified height" explicit for a
    child's percentage-resolution purposes, confirmed empirically here,
    and additionally risks inflating a multi-focused-object column's
    summed content height and spawning an unwanted scrollbar. Scene's
    viewport sets container-type: size, so container query units (cqh)
    resolve correctly instead — this is the documented, sanctioned
    pattern for "fill the available height" (F8 interior contract plan,
    adjudication 2). True percentage-height support would require a
    future CSS mechanism this plan does not attempt to build.

  # --- Touch ---

  Scenario: Finger drag pans a focused column's vertical scroll 1:1
    Given a focused column that overflows the viewport height
    When the user drags a finger vertically on the column
    Then the column's scroll position should track the finger 1:1

  Scenario: Releasing a drag with velocity triggers an inertia fling
    Given the user is dragging a focused column's vertical scroll
    When the user releases with velocity
    Then the column should continue scrolling with decelerating inertia
    And overscroll past the scroll bounds should be clamped

  Scenario: Horizontal camera pan continues to work via native scroll on touch
    Given a scene that overflows horizontally
    When the user performs a horizontal touch gesture on the Camera viewport
    Then the camera should pan horizontally via native overflow scrolling
    Because the Camera viewport itself imposes no touch-action restriction
    (touch-action: auto) — vertical pan is excluded only on a Scene-
    scrollable focused column's own content wrapper (touch-action: pan-x
    pinch-zoom, F8 interior contract), so vertical column drag stays owned
    by that column without restricting any other content in the scene,
    including a consumer's own interior scroll containers
    Note: a column that contains BOTH Scene-scrollable content AND an
    interior native-scroll island (e.g. a SceneObject with its own
    overflow-y: auto) shares this restriction between them — the column's
    touch-action: pan-x pinch-zoom (needed for the column's own drag) also
    blocks vertical touch-pan on the island nested inside it. Known
    limitation, accepted (F8 interior contract plan): don't mix
    Scene-scrollable content and a native-scroll island in the same column.

  Scenario: The scrollbar thumb is touch-operable
    Given a vertical scrollbar is visible
    When the user drags the scrollbar thumb with a finger
    Then the column should scroll to match the thumb's dragged position
    Because the thumb uses touch-action: none so the drag isn't hijacked by
    native scrolling, and has an adequately sized touch hit target
