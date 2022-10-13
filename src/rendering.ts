import * as nunjucks from 'nunjucks';

const renderer = new nunjucks.Environment(null, {trimBlocks: true, autoescape: false})
renderer.addFilter('date', (str, format) => {
  return window.moment(str).format(format);
});

const LAYOUT_TEMPLATE = `
{{metadata}}

## Highlights
{{highlights}}
`;

const METADATA_TEMPLATE = `
## Metadata
* URL: [{{url}}](url)
{% if author %}
* Author: {{author}}
{% endif %}
{% if publisher %}
* Publisher: {{publisher}}
{% endif %}
{% if published_date %}
* Published Date: {{published_date|date("YYYY-MM-DD")}}
{% endif %}
{% if note %}
* Note: {{note}}
{% endif %}
{% if tags %}
* Tags: {% for tag in tags %}#{{tag | replace(' ', '_')}}{% if not loop.last %}, {% endif %}{% endfor%}
{% endif %}
`;

const HIGHLIGHT_TEMPLATE = `
* {{text}}
{% if note %}
  * **Note**: {{note}}
{% endif %}
`;

export {
  renderer,
  LAYOUT_TEMPLATE,
  METADATA_TEMPLATE,
  HIGHLIGHT_TEMPLATE
}
