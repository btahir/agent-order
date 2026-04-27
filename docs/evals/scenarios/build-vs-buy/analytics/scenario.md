# Build vs Buy: Internal Analytics Dashboard

Decide whether to build an internal analytics dashboard in-house or adopt an off-the-shelf product.

Context:

- The company is 80 employees, ~$10M ARR, on a Postgres + Redshift stack.
- The product team needs dashboards for retention, activation, feature adoption, and revenue cohorts. Current state is ad-hoc SQL in a shared notebook.
- Vendor candidates explicitly under consideration: Looker, Mode, Metabase (OSS), Hex, Lightdash. Other vendors may be raised.
- The data team is two engineers. Adding a third would take a quarter to hire and onboard.
- Compliance: any vendor must be SOC 2 Type II. Customer data cannot leave US-region infrastructure.
- Budget envelope for software is $80k / year. Internal build budget would be 1.5 engineer-quarters of work plus ongoing maintenance.

Produce a build-vs-buy memo with a clear recommendation, the options evaluated, the cost comparison over three years, and the risks.
