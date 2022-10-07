export const LAYOUT_TEMPLATE = `
{{metadata}}

## Highlights
{{highlights}}
`

export const METADATA_TEMPLATE = `
## Metadata
* URL: [{{url}}](url)
{% if author %}
* Author: {{author}}
{% endif %}
{% if publisher %}
* Publisher: {{publisher}}
{% endif %}
{% if published_date %}
* Published Date: {{published_date}}
{% endif %}
{% if note %}
* Note: {{note}}
{% endif %}
{% if tags %}
* Tags: {% for tag in tags %}#{{tag | replace(' ', '_')}}{% if not loop.last %}, {% endif %}{% endfor%}
{% endif %}
`

export const HIGHLIGHT_TEMPLATE = `
* {{text}}
{% if note %}
  * **Note**: {{note}}
{% endif %}
`
