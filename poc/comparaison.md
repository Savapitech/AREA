# React vs Svelte — POC Comparison

This document compares **React** and **Svelte** based on the implementation of the **same proof of concept (POC)** with each technology, in order to select the stack for the web interface of the project: an automation platform similar to **IFTTT** and **Zapier**.

---

## Results Overview

| Criteria | React | Svelte | Advantage |
|---|:---:|:---:|:---:|
| Vulnerabilities (`npm audit`) | 0 | 0 | Equal |
| Build time | 149 ms | 397 ms | React |
| Build size | 156 kB | 84 kB | Svelte |
| Number of dependencies | 359 | 139 | Svelte |
| Lighthouse – Performance | 100% | 100% | Equal |
| Lighthouse – Accessibility | 100% | 100% | Equal |
| Lines of code | 80 | 90 | React |
| Documentation | Clear and easy to get started with | Clear, but less extensive | React |

---

## Differences Between React and Svelte

### Where both stacks are equal

- **Security:** No vulnerabilities reported by `npm audit` on either stack.
- **Performance and accessibility:** Both reached 100% on Lighthouse for performance and accessibility.

### Where Svelte has the advantage

- **Build size:** Svelte produces a build approximately **46% smaller** (84 kB vs 156 kB).
- **Dependencies:** Svelte requires approximately **61% fewer dependencies** (139 vs 359).

### Where React has the advantage

- **Build speed:** React builds approximately **2.7 times faster** (149 ms vs 397 ms).
- **Code volume:** React required fewer lines of code for the same POC (80 vs 90).
- **Documentation:** React's documentation is clear, easy to get started with, and more extensive than Svelte's.

---

## Why React for the Web Interface

The web interface of an IFTTT/Zapier-like platform has to manage many screens and interactions: user accounts, service connections, creation and configuration of automations (actions and reactions), and lists of active automations. In this context, React is the better choice for the following reasons:

1. **More extensive documentation.** The interface will contain many features. React's documentation makes it easier to implement them, to solve problems quickly, and to onboard new team members.
2. **Faster builds.** The interface will be rebuilt many times during development. A build that is 2.7 times faster gives the team quicker feedback.
3. **More concise code.** For the same POC, React needed fewer lines of code. Over a large interface, this makes the code easier to read and maintain.
4. **Mature ecosystem.** React has a large community and many maintained libraries for common needs such as routing, forms, data fetching and UI components. The team can rely on proven solutions instead of building them from scratch.
5. **No loss in quality.** React matches Svelte on security, performance and accessibility, so choosing React has no cost on these points.

Svelte's smaller build size and lower number of dependencies are real advantages. However, with both stacks already scoring 100% on Lighthouse performance, these gains have little impact on the user experience of this project.

---

## Conclusion

Both stacks gave equivalent results on security, performance and accessibility. Svelte is lighter, but React offers faster builds, more concise code, more extensive documentation and a more mature ecosystem.

**React is therefore the recommended stack for the web interface of the project.**

