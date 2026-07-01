<?php
/**
 * Admin UI. Renders the dashboard + config, delegating all logic to the backend.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Geo_Admin {

    private $client;

    public function __construct() {
        $this->client = new Geo_Client();
        add_action('admin_menu', array($this, 'menu'));
        add_action('admin_post_geo_save_brand', array($this, 'save_brand'));
        add_action('admin_post_geo_add_prompt', array($this, 'add_prompt'));
        add_action('admin_post_geo_delete_prompt', array($this, 'delete_prompt'));
        add_action('admin_post_geo_add_competitor', array($this, 'add_competitor'));
        add_action('admin_post_geo_delete_competitor', array($this, 'delete_competitor'));
        add_action('admin_post_geo_scan', array($this, 'scan_now'));
        add_action('admin_post_geo_upgrade', array($this, 'upgrade'));
        add_action('admin_post_geo_generate_llms', array($this, 'generate_llms'));
    }

    public function menu() {
        add_menu_page('GEO Monitor', 'GEO Monitor', 'manage_options', 'geo-monitor', array($this, 'render'), 'dashicons-visibility', 58);
    }

    private function ensure_provisioned() {
        if (!get_option('geo_monitor_api_key')) {
            Geo_Provisioning::provision();
        }
        return (bool) get_option('geo_monitor_api_key');
    }

    public function render() {
        if (!$this->ensure_provisioned()) {
            echo '<div class="wrap"><h1>GEO Monitor</h1><div class="notice notice-error"><p>' .
                esc_html__('Could not connect to the GEO backend. Make sure this site is publicly reachable (the backend fetches /?geo_verify=1 to confirm ownership).', 'geo-monitor') .
                '</p></div></div>';
            return;
        }

        $tenant = $this->client->get('/api/v1/tenant');
        $dash   = $this->client->get('/api/v1/dashboard');
        $t = (!is_wp_error($tenant) && isset($tenant['tenant'])) ? $tenant['tenant'] : array();
        $limits = (!is_wp_error($tenant) && isset($tenant['limits'])) ? $tenant['limits'] : array();

        echo '<div class="wrap"><h1>GEO Monitor</h1>';
        printf('<p><strong>%s:</strong> %s</p>', esc_html__('Plan', 'geo-monitor'), esc_html(isset($t['plan']) ? $t['plan'] : 'FREE'));

        // Dashboard
        echo '<h2>' . esc_html__('AI Visibility', 'geo-monitor') . '</h2>';
        if (is_wp_error($dash) || empty($dash['hasData'])) {
            echo '<p>' . esc_html__('No scans yet. Add a prompt and run a scan.', 'geo-monitor') . '</p>';
        } else {
            echo '<table class="widefat striped"><thead><tr><th>Engine</th><th>Mention rate</th><th>Avg. position</th><th>Sentiment</th></tr></thead><tbody>';
            foreach ($dash['providers'] as $p) {
                printf(
                    '<tr><td>%s</td><td>%d%%</td><td>%s</td><td>%s</td></tr>',
                    esc_html($p['provider']),
                    (int) round($p['mentionRate'] * 100),
                    esc_html($p['avgPosition'] !== null ? number_format($p['avgPosition'], 1) : '—'),
                    esc_html($p['sentiment'])
                );
            }
            echo '</tbody></table>';
        }

        $this->render_form('geo_scan', __('Run scan now', 'geo-monitor'));

        // Brand settings
        echo '<h2>' . esc_html__('Brand', 'geo-monitor') . '</h2>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('geo_save_brand');
        echo '<input type="hidden" name="action" value="geo_save_brand" />';
        printf('<p><label>%s<br><input type="text" name="brandName" value="%s" class="regular-text" /></label></p>',
            esc_html__('Brand name', 'geo-monitor'), esc_attr(isset($t['brandName']) ? $t['brandName'] : ''));
        printf('<p><label>%s<br><input type="text" name="primaryDomain" value="%s" class="regular-text" placeholder="example.com" /></label></p>',
            esc_html__('Primary domain', 'geo-monitor'), esc_attr(isset($t['primaryDomain']) ? $t['primaryDomain'] : ''));
        submit_button(__('Save brand', 'geo-monitor'));
        echo '</form>';

        // Prompts
        echo '<h2>' . esc_html__('Tracked prompts', 'geo-monitor') . '</h2>';
        if (!empty($t['prompts'])) {
            echo '<ul>';
            foreach ($t['prompts'] as $p) {
                echo '<li>' . esc_html($p['text']) . ' ';
                $this->inline_delete('geo_delete_prompt', $p['id'], 'promptId');
                echo '</li>';
            }
            echo '</ul>';
        }
        $maxPrompts = isset($limits['maxPrompts']) ? (int) $limits['maxPrompts'] : 1;
        if (empty($t['prompts']) || count($t['prompts']) < $maxPrompts) {
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
            wp_nonce_field('geo_add_prompt');
            echo '<input type="hidden" name="action" value="geo_add_prompt" />';
            echo '<input type="text" name="text" class="regular-text" placeholder="best vegan protein powder" /> ';
            submit_button(__('Add prompt', 'geo-monitor'), 'secondary', 'submit', false);
            echo '</form>';
        } else {
            printf('<p><em>%s</em></p>', esc_html__('Prompt limit reached for your plan.', 'geo-monitor'));
        }

        // Competitors
        echo '<h2>' . esc_html__('Competitors', 'geo-monitor') . '</h2>';
        if (!empty($t['competitors'])) {
            echo '<ul>';
            foreach ($t['competitors'] as $comp) {
                echo '<li>' . esc_html($comp['name']) . ' ';
                $this->inline_delete('geo_delete_competitor', $comp['id'], 'competitorId');
                echo '</li>';
            }
            echo '</ul>';
        }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('geo_add_competitor');
        echo '<input type="hidden" name="action" value="geo_add_competitor" />';
        echo '<input type="text" name="name" class="regular-text" placeholder="Competitor brand" /> ';
        submit_button(__('Add competitor', 'geo-monitor'), 'secondary', 'submit', false);
        echo '</form>';

        // Content
        echo '<h2>' . esc_html__('AI content', 'geo-monitor') . '</h2>';
        $this->render_form('geo_generate_llms', __('Generate & publish llms.txt', 'geo-monitor'));
        printf('<p><a href="%s" target="_blank">%s</a></p>', esc_url(home_url('/llms.txt')), esc_html__('View llms.txt', 'geo-monitor'));

        // Billing
        echo '<h2>' . esc_html__('Upgrade', 'geo-monitor') . '</h2>';
        foreach (array('STARTER', 'GROWTH', 'PRO') as $plan) {
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline-block;margin-right:8px;">';
            wp_nonce_field('geo_upgrade');
            echo '<input type="hidden" name="action" value="geo_upgrade" />';
            echo '<input type="hidden" name="plan" value="' . esc_attr($plan) . '" />';
            submit_button(sprintf(__('Upgrade to %s', 'geo-monitor'), $plan), 'primary', 'submit', false);
            echo '</form>';
        }
        echo '</div>';
    }

    private function render_form($action, $label) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field($action);
        echo '<input type="hidden" name="action" value="' . esc_attr($action) . '" />';
        submit_button($label, 'secondary', 'submit', false);
        echo '</form>';
    }

    private function inline_delete($action, $id, $field) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline">';
        wp_nonce_field($action);
        echo '<input type="hidden" name="action" value="' . esc_attr($action) . '" />';
        echo '<input type="hidden" name="' . esc_attr($field) . '" value="' . esc_attr($id) . '" />';
        submit_button(__('Delete', 'geo-monitor'), 'link-delete', 'submit', false);
        echo '</form>';
    }

    private function guard($action) {
        if (!current_user_can('manage_options')) {
            wp_die('Forbidden');
        }
        check_admin_referer($action);
    }

    private function back() {
        wp_safe_redirect(admin_url('admin.php?page=geo-monitor'));
        exit;
    }

    public function save_brand() {
        $this->guard('geo_save_brand');
        $this->client->post('/api/v1/tenant', array(
            'brandName'     => sanitize_text_field(wp_unslash($_POST['brandName'] ?? '')),
            'primaryDomain' => sanitize_text_field(wp_unslash($_POST['primaryDomain'] ?? '')),
        ));
        $this->back();
    }

    public function add_prompt() {
        $this->guard('geo_add_prompt');
        $this->client->post('/api/v1/prompts', array('text' => sanitize_text_field(wp_unslash($_POST['text'] ?? ''))));
        $this->back();
    }

    public function delete_prompt() {
        $this->guard('geo_delete_prompt');
        $this->client->delete('/api/v1/prompts/' . rawurlencode(sanitize_text_field(wp_unslash($_POST['promptId'] ?? ''))));
        $this->back();
    }

    public function add_competitor() {
        $this->guard('geo_add_competitor');
        $this->client->post('/api/v1/competitors', array('name' => sanitize_text_field(wp_unslash($_POST['name'] ?? ''))));
        $this->back();
    }

    public function delete_competitor() {
        $this->guard('geo_delete_competitor');
        $this->client->delete('/api/v1/competitors/' . rawurlencode(sanitize_text_field(wp_unslash($_POST['competitorId'] ?? ''))));
        $this->back();
    }

    public function scan_now() {
        $this->guard('geo_scan');
        Geo_Sync::push(); // send the latest catalog before scanning
        $this->client->post('/api/v1/scan');
        $this->back();
    }

    public function generate_llms() {
        $this->guard('geo_generate_llms');
        Geo_Sync::push(); // ensure the backend has the latest catalog
        $res = $this->client->post('/api/v1/content/llms-txt');
        if (!is_wp_error($res) && !empty($res['content'])) {
            update_option('geo_monitor_llms_txt', $res['content'], false);
        }
        $this->back();
    }

    public function upgrade() {
        $this->guard('geo_upgrade');
        $plan = sanitize_text_field(wp_unslash($_POST['plan'] ?? 'STARTER'));
        $res = $this->client->post('/api/v1/billing/checkout', array(
            'plan'      => $plan,
            'returnUrl' => admin_url('admin.php?page=geo-monitor'),
        ));
        if (!is_wp_error($res) && !empty($res['url'])) {
            wp_redirect(esc_url_raw($res['url']));
            exit;
        }
        $this->back();
    }
}
