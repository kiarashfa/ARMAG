<p>
  <a href="https://kiarashfa.github.io/ARMAG/">
    <img src="public/og-image.jpg" alt="ARMAG: Every figure sourced. Every gap shown." width="100%">
  </a>
</p>

<div align="center">

[![Live site](https://img.shields.io/badge/Live_site-kiarashfa.github.io%2FARMAG-1ec5e4?style=for-the-badge)](https://kiarashfa.github.io/ARMAG/) [![Donate with PayPal](https://img.shields.io/badge/Donate_on_PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://www.paypal.com/donate/?hosted_button_id=S3BD5XFBMMWSJ) [![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/kiarashfa)

![Website status](https://img.shields.io/website?url=https%3A%2F%2Fkiarashfa.github.io%2FARMAG%2F&label=website&style=flat) ![Deployment](https://img.shields.io/github/deployments/kiarashfa/ARMAG/github-pages?style=flat) ![Last commit](https://img.shields.io/github/last-commit/kiarashfa/ARMAG?style=flat) ![Commit activity](https://img.shields.io/github/commit-activity/y/kiarashfa/ARMAG?style=flat) ![Created](https://img.shields.io/github/created-at/kiarashfa/ARMAG?style=flat) ![Stars](https://img.shields.io/github/stars/kiarashfa/ARMAG?style=flat)

</div>

**ARMAG** (from _arm_ + _magazine_) is a non-profit reference for firearms. The name works twice over: a magazine is what a firearm is fed from, and a magazine is what this is, with one page per firearm, cartridge and manufacturer, laid out like a magazine rather than a database dump.

Every figure is either sourced or computed, and it always says which. A number nobody has published yet is shown as a gap rather than quietly filled in. It also does the physics, from trajectory and retained energy to recoil, and every derived number shows its formula and where each input came from. What you save stays in your own browser.

Under the hood, it is a static site built with Astro and Svelte. Every firearm, cartridge and manufacturer is structured content that a schema checks at build time: a figure marked verified without a source link, or a hedge word in a source note, stops the build. Trajectories are integrated in your browser with a Runge-Kutta solver over the public-domain G1 and G7 drag tables, validated against published ballistic tables.

## License and credits

The code is released under the [KFA Source-Available License 1.0](LICENSE). It is **source-available, not open source**: you can read it, fork it and run it privately, but deploying it, modifying it and commercial use need written permission.

Third-party software, data and media are credited in [THIRD_PARTY.md](THIRD_PARTY.md).

---

© 2026 Kiarash Farajzadehahary.

Made with ❤️ for those who respect every round.
