/// Type declarations for HubSpot's odometer.js.
///
/// The package ships no types and there is no @types/odometer on npm (404), so
/// these are hand-written against the documented options at
/// https://github.hubspot.com/odometer/ — kept deliberately narrow to the
/// surface we actually use rather than guessing at the rest.

declare module 'odometer' {
  interface OdometerOptions {
    /** Element the odometer renders into. */
    el: HTMLElement;
    /** Initial value. */
    value?: number;
    /** Transition duration in ms. */
    duration?: number;
    /** Digit-grouping format, e.g. 'd', '(,ddd)', '(,ddd).dd'. */
    format?: string;
    /** Theme name, when loading themes at runtime rather than via CSS import. */
    theme?: string;
    /** Animation style: 'count' steps through every value, 'slide' does not. */
    animation?: 'count' | 'slide';
  }

  class Odometer {
    constructor(options: OdometerOptions);
    /** Animates to a new value. */
    update(value: number): void;
    /** Renders the current value immediately. */
    render(value?: number): void;
  }

  export default Odometer;
}

declare module 'odometer/themes/*.css';
