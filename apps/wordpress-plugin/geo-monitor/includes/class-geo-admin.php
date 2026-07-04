<?php
/**
 * Admin UI. Card-based dashboard; all logic is delegated to the backend.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Geo_Admin {

    private $client;

    public function __construct() {
        $this->client = new Geo_Client();
        add_action('admin_menu', array($this, 'menu'));
        add_action('admin_enqueue_scripts', array($this, 'assets'));
        add_action('admin_post_geo_save_brand', array($this, 'save_brand'));
        add_action('admin_post_geo_add_prompt', array($this, 'add_prompt'));
        add_action('admin_post_geo_delete_prompt', array($this, 'delete_prompt'));
        add_action('admin_post_geo_add_competitor', array($this, 'add_competitor'));
        add_action('admin_post_geo_delete_competitor', array($this, 'delete_competitor'));
        add_action('admin_post_geo_scan', array($this, 'scan_now'));
        add_action('admin_post_geo_upgrade', array($this, 'upgrade'));
        add_action('admin_post_geo_generate_llms', array($this, 'generate_llms'));
        add_action('admin_post_geo_deep', array($this, 'run_deep'));
    }

    public function menu() {
        add_menu_page('GEO Monitor', 'GEO Monitor', 'manage_options', 'geo-monitor', array($this, 'render'), 'dashicons-visibility', 58);
    }

    public function assets($hook) {
        if ($hook !== 'toplevel_page_geo-monitor') {
            return;
        }
        wp_enqueue_style('geo-monitor-admin', GEO_MONITOR_URL . 'assets/admin.css', array(), GEO_MONITOR_VERSION);
    }

    private function ensure_provisioned() {
        if (!get_option('geo_monitor_api_key')) {
            Geo_Provisioning::provision();
        }
        return (bool) get_option('geo_monitor_api_key');
    }

    private function header($plan = null) {
        echo '<div class="geo-header"><span class="geo-logo">📡</span><div><h1>GEO Monitor</h1>';
        echo '<span class="geo-sub">' . esc_html__('See how AI assistants recommend your store', 'geo-monitor') . '</span></div>';
        if ($plan !== null) {
            printf('<span class="geo-plan">%s</span>', esc_html($plan));
        }
        echo '</div>';
    }

    public function render() {
        if (!$this->ensure_provisioned()) {
            echo '<div class="wrap geo-wrap">';
            $this->header();
            echo '<div class="geo-note warn">' .
                esc_html__('Could not connect to the GEO backend. Make sure this site is publicly reachable — the backend fetches /?geo_verify=1 to confirm ownership.', 'geo-monitor') .
                '</div></div>';
            return;
        }

        $tenant = $this->client->get('/api/v1/tenant');
        $dash   = $this->client->get('/api/v1/dashboard');
        $plans  = $this->client->get('/api/v1/plans');
        $t = (!is_wp_error($tenant) && isset($tenant['tenant'])) ? $tenant['tenant'] : array();
        $limits = (!is_wp_error($tenant) && isset($tenant['limits'])) ? $tenant['limits'] : array();

        $plan        = isset($t['plan']) ? $t['plan'] : 'FREE';
        $brand       = isset($t['brandName']) ? $t['brandName'] : '';
        $domain      = isset($t['primaryDomain']) ? $t['primaryDomain'] : '';
        $prompts     = !empty($t['prompts']) ? $t['prompts'] : array();
        $competitors = !empty($t['competitors']) ? $t['competitors'] : array();

        echo '<div class="wrap geo-wrap">';
        $this->header($plan);
        $this->notices();
        echo '<div class="geo-grid">';

        // --- AI Visibility + Deep Analysis -----------------------------------
        $this->render_visibility($dash, $limits, $brand, $prompts);
        $this->render_deep($dash);

        // --- Brand -----------------------------------------------------------
        echo '<div class="geo-card"><h2>' . esc_html__('Brand', 'geo-monitor') . '</h2>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('geo_save_brand');
        echo '<input type="hidden" name="action" value="geo_save_brand" />';
        echo '<div class="geo-field"><label>' . esc_html__('Brand name', 'geo-monitor') . '</label>' .
            '<input class="geo-input" type="text" name="brandName" value="' . esc_attr($brand) . '" placeholder="Jungbrunn" /></div>';
        echo '<div class="geo-field"><label>' . esc_html__('Primary domain', 'geo-monitor') . '</label>' .
            '<input class="geo-input" type="text" name="primaryDomain" value="' . esc_attr($domain) . '" placeholder="example.com" /></div>';
        echo '<button type="submit" class="geo-btn geo-btn-primary">' . esc_html__('Save brand', 'geo-monitor') . '</button>';
        echo '</form></div>';

        // --- Prompts ---------------------------------------------------------
        echo '<div class="geo-card"><h2>' . esc_html__('Tracked prompts', 'geo-monitor') . '</h2>';
        echo '<p class="geo-hint">' . esc_html__('Questions people ask AI assistants where your brand should show up.', 'geo-monitor') . '</p>';
        if ($prompts) {
            echo '<ul class="geo-chips">';
            foreach ($prompts as $p) {
                echo '<li class="geo-chip"><span>' . esc_html($p['text']) . '</span>';
                $this->inline_delete('geo_delete_prompt', $p['id'], 'promptId');
                echo '</li>';
            }
            echo '</ul>';
        }
        $maxPrompts = isset($limits['maxPrompts']) ? (int) $limits['maxPrompts'] : 1;
        if (!$prompts || count($prompts) < $maxPrompts) {
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><div class="geo-row">';
            wp_nonce_field('geo_add_prompt');
            echo '<input type="hidden" name="action" value="geo_add_prompt" />';
            echo '<input class="geo-input" type="text" name="text" placeholder="best vegan protein powder" />';
            echo '<button type="submit" class="geo-btn geo-btn-ghost">' . esc_html__('Add prompt', 'geo-monitor') . '</button>';
            echo '</div></form>';
        } else {
            echo '<p class="geo-muted">' . esc_html__('Prompt limit reached for your plan.', 'geo-monitor') . '</p>';
        }
        echo '</div>';

        // --- Competitors -----------------------------------------------------
        echo '<div class="geo-card"><h2>' . esc_html__('Competitors', 'geo-monitor') . '</h2>';
        echo '<p class="geo-hint">' . esc_html__('Brands to compare against in AI answers.', 'geo-monitor') . '</p>';
        if ($competitors) {
            echo '<ul class="geo-chips">';
            foreach ($competitors as $comp) {
                echo '<li class="geo-chip"><span>' . esc_html($comp['name']) . '</span>';
                $this->inline_delete('geo_delete_competitor', $comp['id'], 'competitorId');
                echo '</li>';
            }
            echo '</ul>';
        }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><div class="geo-row">';
        wp_nonce_field('geo_add_competitor');
        echo '<input type="hidden" name="action" value="geo_add_competitor" />';
        echo '<input class="geo-input" type="text" name="name" placeholder="Competitor brand" />';
        echo '<button type="submit" class="geo-btn geo-btn-ghost">' . esc_html__('Add competitor', 'geo-monitor') . '</button>';
        echo '</div></form></div>';

        // --- AI content ------------------------------------------------------
        echo '<div class="geo-card"><h2>' . esc_html__('AI content', 'geo-monitor') . '</h2>';
        echo '<p class="geo-hint">' . esc_html__('Publish an llms.txt so AI crawlers understand what your site offers.', 'geo-monitor') . '</p>';
        echo '<div class="geo-row">';
        $this->action_form('geo_generate_llms', __('Generate llms.txt', 'geo-monitor'), 'primary');
        echo '<a class="geo-btn geo-btn-ghost" href="' . esc_url(home_url('/llms.txt')) . '" target="_blank" rel="noopener">' .
            esc_html__('View llms.txt', 'geo-monitor') . '</a>';
        echo '</div></div>';

        // --- Plans & pricing -------------------------------------------------
        $catalog = (!is_wp_error($plans) && !empty($plans['plans'])) ? $plans['plans'] : array();
        if ($catalog) {
            echo '<div class="geo-card span2"><h2>' . esc_html__('Plans & pricing', 'geo-monitor') . '</h2>';
            echo '<p class="geo-hint">' . esc_html__('Billed securely via Stripe. Prices in USD per month.', 'geo-monitor') . '</p>';
            echo '<div class="geo-plans">';
            foreach ($catalog as $p) {
                $pid   = isset($p['id']) ? $p['id'] : '';
                $isCur = ($plan === $pid);
                $pop   = !empty($p['popular']);
                $cls   = 'geo-plan-card' . ($pop ? ' popular' : '') . ($isCur ? ' current' : '');
                echo '<div class="' . esc_attr($cls) . '">';
                echo '<div class="name">' . esc_html(isset($p['name']) ? $p['name'] : $pid);
                if ($pop)   echo ' <span class="geo-tag">' . esc_html__('Popular', 'geo-monitor') . '</span>';
                if ($isCur) echo ' <span class="geo-tag ok">' . esc_html__('Current', 'geo-monitor') . '</span>';
                echo '</div>';
                echo '<div class="price">$' . esc_html((string) (isset($p['priceUsd']) ? $p['priceUsd'] : 0));
                if ((float) (isset($p['priceUsd']) ? $p['priceUsd'] : 0) > 0) {
                    echo '<span class="per">' . esc_html__('/mo', 'geo-monitor') . '</span>';
                }
                echo '</div>';
                echo '<ul class="geo-feats">';
                foreach ((array) (isset($p['features']) ? $p['features'] : array()) as $f) {
                    echo '<li>' . esc_html($f) . '</li>';
                }
                echo '</ul>';
                if ($isCur) {
                    echo '<button type="button" class="geo-btn geo-btn-ghost" disabled>' . esc_html__('Current plan', 'geo-monitor') . '</button>';
                } elseif ($pid === 'FREE') {
                    echo '<span class="geo-muted">' . esc_html__('Free tier', 'geo-monitor') . '</span>';
                } else {
                    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
                    wp_nonce_field('geo_upgrade');
                    echo '<input type="hidden" name="action" value="geo_upgrade" /><input type="hidden" name="plan" value="' . esc_attr($pid) . '" />';
                    echo '<button type="submit" class="geo-btn geo-btn-primary">' . esc_html(sprintf(__('Choose %s', 'geo-monitor'), isset($p['name']) ? $p['name'] : $pid)) . '</button>';
                    echo '</form>';
                }
                echo '</div>';
            }
            echo '</div></div>';
        }

        echo '</div></div>'; // .geo-grid, .wrap
    }

    private function notices() {
        $n = isset($_GET['geo_notice']) ? sanitize_key(wp_unslash($_GET['geo_notice'])) : '';
        if ($n === 'scan') {
            echo '<div class="geo-note info">' . esc_html__('Scan started — results appear in ~15–30s. Reload this page.', 'geo-monitor') . '</div>';
        } elseif ($n === 'llms') {
            echo '<div class="geo-note ok">' . esc_html__('llms.txt generated and published.', 'geo-monitor') . '</div>';
        } elseif ($n === 'saved') {
            echo '<div class="geo-note ok">' . esc_html__('Saved.', 'geo-monitor') . '</div>';
        } elseif ($n === 'billing_error') {
            echo '<div class="geo-note warn">' . esc_html__('Paid plans aren’t available yet — billing is being set up. You’re on FREE for now.', 'geo-monitor') . '</div>';
        }
    }

    /** AI Visibility table: real rows for in-plan engines, locked rows for the rest. */
    private function render_visibility($dash, $limits, $brand, $prompts) {
        $engines = array(
            'OPENAI'     => 'ChatGPT',
            'ANTHROPIC'  => 'Claude',
            'GEMINI'     => 'Gemini',
            'PERPLEXITY' => 'Perplexity',
        );
        $allowed = (isset($limits['providers']) && is_array($limits['providers'])) ? $limits['providers'] : array('OPENAI');
        $data = array();
        if (!is_wp_error($dash) && !empty($dash['providers'])) {
            foreach ($dash['providers'] as $p) {
                $data[strtoupper($p['provider'])] = $p;
            }
        }
        $hasData = !is_wp_error($dash) && !empty($dash['hasData']);

        echo '<div class="geo-card span2"><h2>' . esc_html__('AI Visibility', 'geo-monitor') . '</h2>';
        echo '<table class="geo-metrics"><thead><tr><th>' . esc_html__('Engine', 'geo-monitor') . '</th><th>' .
            esc_html__('Mention rate', 'geo-monitor') . '</th><th>' . esc_html__('Avg. position', 'geo-monitor') .
            '</th><th>' . esc_html__('Sentiment', 'geo-monitor') . '</th></tr></thead><tbody>';

        foreach ($engines as $key => $label) {
            if (!in_array($key, $allowed, true)) {
                printf(
                    '<tr class="locked"><td class="geo-engine">%s</td><td colspan="3"><span class="geo-lock">🔒 %s <span class="up">%s</span></span></td></tr>',
                    esc_html($label),
                    esc_html__('Premium', 'geo-monitor'),
                    esc_html__('— upgrade to track this engine', 'geo-monitor')
                );
                continue;
            }
            if (isset($data[$key])) {
                $p = $data[$key];
                $rate = (int) round($p['mentionRate'] * 100);
                $sent = strtoupper((string) $p['sentiment']);
                $cls  = $sent === 'POSITIVE' ? 'pos' : ($sent === 'NEGATIVE' ? 'neg' : 'neu');
                printf(
                    '<tr><td class="geo-engine">%s</td>' .
                    '<td><div class="geo-row" style="gap:10px"><span class="geo-bar"><span style="width:%d%%"></span></span><span>%d%%</span></div></td>' .
                    '<td>%s</td><td><span class="geo-badge %s">%s</span></td></tr>',
                    esc_html($label), $rate, $rate,
                    esc_html($p['avgPosition'] !== null ? number_format($p['avgPosition'], 1) : '—'),
                    esc_attr($cls), esc_html($sent)
                );
            } else {
                printf('<tr><td class="geo-engine">%s</td><td colspan="3" class="geo-muted">%s</td></tr>',
                    esc_html($label), esc_html__('No scans yet', 'geo-monitor'));
            }
        }
        echo '</tbody></table>';

        if (!$hasData) {
            echo '<p class="geo-muted" style="margin-top:14px">';
            if (!$brand) {
                echo esc_html__('Set your brand name and add a prompt, then run a scan.', 'geo-monitor');
            } elseif (!$prompts) {
                echo esc_html__('Add at least one prompt, then run a scan.', 'geo-monitor');
            } else {
                echo esc_html__('Run your first scan to see results.', 'geo-monitor');
            }
            echo '</p>';
        }

        echo '<div style="margin-top:16px">';
        $this->action_form('geo_scan', __('Run scan now', 'geo-monitor'), 'primary');
        echo '<p class="geo-muted" style="margin-top:10px">' .
            esc_html__('Scans run in the background (~15–30s). Reload the page to see results.', 'geo-monitor') . '</p>';
        echo '</div></div>';
    }

    /**
     * Deep Analysis: share of AI answers, competitor gaps, and a concrete fix list
     * from the Action-Layer audit. Free during beta; the button is where a plan
     * gate goes later.
     */
    private function render_deep($dash) {
        $active = isset($_GET['geo_deep']) && $_GET['geo_deep'] === '1';

        echo '<div class="geo-card span2"><h2>' . esc_html__('Deep Analysis', 'geo-monitor') .
            '<span class="geo-ribbon">' . esc_html__('Beta · free', 'geo-monitor') . '</span></h2>';

        if (!$active) {
            echo '<div class="geo-deep-teaser"><p class="geo-hint">' .
                esc_html__('See where competitors beat you in AI answers — and exactly what to fix on your site so assistants recommend you.', 'geo-monitor') . '</p>';
            $this->action_form('geo_deep', __('Show deep analysis', 'geo-monitor'), 'primary');
            echo '</div></div>';
            return;
        }

        $share = (!is_wp_error($dash) && isset($dash['shareOfModel'])) ? $dash['shareOfModel'] : null;
        $gaps  = (!is_wp_error($dash) && !empty($dash['gaps'])) ? $dash['gaps'] : array();
        $recsRes = $this->client->get('/api/v1/recommendations');
        $recs = (!is_wp_error($recsRes) && !empty($recsRes['recommendations'])) ? $recsRes['recommendations'] : array();

        // Share of AI answers
        echo '<div class="geo-insight"><h3>' . esc_html__('Share of AI answers', 'geo-monitor') . '</h3>';
        $rows = array();
        if ($share) {
            $rows[] = array('name' => __('You', 'geo-monitor'), 'count' => isset($share['brand']) ? (int) $share['brand'] : 0, 'me' => true);
            if (!empty($share['competitors'])) {
                foreach ($share['competitors'] as $comp) {
                    $rows[] = array('name' => $comp['name'], 'count' => (int) $comp['count'], 'me' => false);
                }
            }
        }
        if (count($rows) && array_sum(array_column($rows, 'count')) > 0) {
            $max = 1;
            foreach ($rows as $r) { $max = max($max, $r['count']); }
            foreach ($rows as $r) {
                printf('<div class="geo-sh"><span class="lbl">%s</span><span class="track"><span class="%s" style="width:%d%%"></span></span><span class="val">%d</span></div>',
                    esc_html($r['name']), $r['me'] ? 'me' : 'them', (int) round($r['count'] / $max * 100), $r['count']);
            }
        } else {
            echo '<p class="geo-muted">' . esc_html__('No mentions recorded yet — run a scan first.', 'geo-monitor') . '</p>';
        }
        echo '</div>';

        // Competitor gaps
        echo '<div class="geo-insight"><h3>' . esc_html__('Where competitors win', 'geo-monitor') . '</h3>';
        if (!empty($gaps)) {
            echo '<ul class="geo-chips">';
            foreach ($gaps as $g) {
                printf('<li class="geo-chip"><span>%s</span><span class="geo-muted">%s</span></li>',
                    esc_html($g['name']),
                    sprintf(esc_html__('named in %d answers you missed', 'geo-monitor'), (int) $g['count']));
            }
            echo '</ul>';
        } else {
            echo '<p class="geo-muted">' . esc_html__('No competitor gaps detected yet.', 'geo-monitor') . '</p>';
        }
        echo '</div>';

        // Site readiness fixes (from the audit)
        echo '<div class="geo-insight"><h3>' . esc_html__('Fix these to get recommended', 'geo-monitor') . '</h3>';
        if (!empty($recs)) {
            echo '<ul class="geo-recs">';
            foreach ($recs as $r) {
                $sev = isset($r['severity']) ? max(1, min(3, (int) $r['severity'])) : 2;
                printf('<li class="geo-rec"><span class="sev s%d"></span><div><div class="t">%s</div><div class="d">%s</div></div></li>',
                    $sev, esc_html($r['title']), esc_html($r['detail']));
            }
            echo '</ul>';
        } else {
            echo '<p class="geo-muted">' . esc_html__('No issues found in the latest audit — nice.', 'geo-monitor') . '</p>';
        }
        echo '</div></div>';
    }

    private function action_form($action, $label, $style = 'ghost') {
        $cls = $style === 'primary' ? 'geo-btn-primary' : 'geo-btn-ghost';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline">';
        wp_nonce_field($action);
        echo '<input type="hidden" name="action" value="' . esc_attr($action) . '" />';
        echo '<button type="submit" class="geo-btn ' . esc_attr($cls) . '">' . esc_html($label) . '</button>';
        echo '</form>';
    }

    private function inline_delete($action, $id, $field) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="margin:0">';
        wp_nonce_field($action);
        echo '<input type="hidden" name="action" value="' . esc_attr($action) . '" />';
        echo '<input type="hidden" name="' . esc_attr($field) . '" value="' . esc_attr($id) . '" />';
        echo '<button type="submit" class="geo-btn geo-btn-link">' . esc_html__('Remove', 'geo-monitor') . '</button>';
        echo '</form>';
    }

    private function guard($action) {
        if (!current_user_can('manage_options')) {
            wp_die('Forbidden');
        }
        check_admin_referer($action);
    }

    private function back($notice = '') {
        $url = admin_url('admin.php?page=geo-monitor');
        if ($notice) {
            $url = add_query_arg('geo_notice', $notice, $url);
        }
        wp_safe_redirect($url);
        exit;
    }

    public function save_brand() {
        $this->guard('geo_save_brand');
        $this->client->post('/api/v1/tenant', array(
            'brandName'     => sanitize_text_field(wp_unslash($_POST['brandName'] ?? '')),
            'primaryDomain' => sanitize_text_field(wp_unslash($_POST['primaryDomain'] ?? '')),
        ));
        $this->back('saved');
    }

    public function add_prompt() {
        $this->guard('geo_add_prompt');
        $this->client->post('/api/v1/prompts', array('text' => sanitize_text_field(wp_unslash($_POST['text'] ?? ''))));
        $this->back('saved');
    }

    public function delete_prompt() {
        $this->guard('geo_delete_prompt');
        $this->client->delete('/api/v1/prompts/' . rawurlencode(sanitize_text_field(wp_unslash($_POST['promptId'] ?? ''))));
        $this->back();
    }

    public function add_competitor() {
        $this->guard('geo_add_competitor');
        $this->client->post('/api/v1/competitors', array('name' => sanitize_text_field(wp_unslash($_POST['name'] ?? ''))));
        $this->back('saved');
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
        $this->back('scan');
    }

    public function generate_llms() {
        $this->guard('geo_generate_llms');
        Geo_Sync::push(); // ensure the backend has the latest catalog
        $res = $this->client->post('/api/v1/content/llms-txt');
        if (!is_wp_error($res) && !empty($res['content'])) {
            update_option('geo_monitor_llms_txt', $res['content'], false);
        }
        $this->back('llms');
    }

    public function run_deep() {
        $this->guard('geo_deep');
        // Run the Action-Layer audit (robots.txt + schema) so the fix list is fresh.
        $this->client->post('/api/v1/audit');
        wp_safe_redirect(add_query_arg('geo_deep', '1', admin_url('admin.php?page=geo-monitor')));
        exit;
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
        $this->back('billing_error');
    }
}
