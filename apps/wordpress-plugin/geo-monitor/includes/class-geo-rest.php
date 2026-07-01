<?php
/**
 * Public routes (no REST API needed — these are plain front-end requests, so they
 * work even when /wp-json is locked down):
 *   GET /?geo_verify=1 : serves the onboarding token (domain-control proof).
 *   GET /llms.txt      : serves the llms.txt pulled from the backend.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Geo_Rest {

    public function __construct() {
        add_action('init', array($this, 'rewrite'));
        add_action('template_redirect', array($this, 'serve'));
        add_filter('query_vars', function ($vars) {
            $vars[] = 'geo_llms';
            $vars[] = 'geo_verify';
            return $vars;
        });
    }

    public function rewrite() {
        add_rewrite_rule('^llms\.txt$', 'index.php?geo_llms=1', 'top');
    }

    public function serve() {
        // Onboarding token — reachable at the public site root via query var,
        // so no rewrite flush is required for provisioning to succeed.
        if (intval(get_query_var('geo_verify')) === 1) {
            header('Content-Type: text/plain; charset=utf-8');
            echo (string) get_option('geo_monitor_verify_token', '');
            exit;
        }

        if (intval(get_query_var('geo_llms')) === 1) {
            header('Content-Type: text/plain; charset=utf-8');
            echo (string) get_option('geo_monitor_llms_txt', "# llms.txt not generated yet\n");
            exit;
        }
    }
}
