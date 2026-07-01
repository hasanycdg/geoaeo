<?php
/**
 * Gathers the store profile + catalog LOCALLY (WP/Woo functions, no REST) and
 * pushes them to the backend, which caches them on the tenant. This is what lets
 * the whole thing work on hosts that block /wp-json externally.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Geo_Sync {

    public static function collect_profile() {
        return array(
            'name'        => get_bloginfo('name'),
            'description' => get_bloginfo('description'),
            'primaryUrl'  => home_url('/'),
        );
    }

    /** Up to 100 items: WooCommerce products if present, else published posts. */
    public static function collect_catalog() {
        $items = array();

        if (class_exists('WooCommerce') && function_exists('wc_get_products')) {
            $products = wc_get_products(array('status' => 'publish', 'limit' => 100));
            foreach ($products as $p) {
                $id = $p->get_id();
                $desc = $p->get_description() ? $p->get_description() : $p->get_short_description();
                $items[] = array(
                    'externalId'  => (string) $id,
                    'title'       => $p->get_name(),
                    'handle'      => $p->get_slug(),
                    'description' => self::clean($desc),
                    'url'         => get_permalink($id),
                    'productType' => self::first_term($id, 'product_cat'),
                    'tags'        => self::term_names($id, 'product_tag'),
                );
            }
            return $items;
        }

        $posts = get_posts(array('numberposts' => 100, 'post_status' => 'publish'));
        foreach ($posts as $post) {
            $excerpt = get_the_excerpt($post);
            $items[] = array(
                'externalId'  => (string) $post->ID,
                'title'       => get_the_title($post),
                'handle'      => $post->post_name,
                'description' => self::clean($excerpt ? $excerpt : wp_trim_words($post->post_content, 60)),
                'url'         => get_permalink($post->ID),
                'productType' => self::first_term($post->ID, 'category'),
                'tags'        => self::term_names($post->ID, 'post_tag'),
            );
        }
        return $items;
    }

    /** Push profile + catalog to the backend. Requires an API key. */
    public static function push() {
        if (!get_option('geo_monitor_api_key')) {
            return false;
        }
        $client = new Geo_Client();
        $res = $client->post('/api/v1/wp/sync', array(
            'storeProfile' => self::collect_profile(),
            'catalog'      => self::collect_catalog(),
        ));
        return !is_wp_error($res);
    }

    private static function clean($html) {
        $text = wp_strip_all_tags((string) $html);
        $text = trim(preg_replace('/\s+/', ' ', $text));
        return $text !== '' ? $text : null;
    }

    private static function first_term($id, $taxonomy) {
        $terms = get_the_terms($id, $taxonomy);
        return ($terms && !is_wp_error($terms)) ? $terms[0]->name : null;
    }

    private static function term_names($id, $taxonomy) {
        $terms = get_the_terms($id, $taxonomy);
        if (!$terms || is_wp_error($terms)) {
            return array();
        }
        return array_values(array_map(function ($t) { return $t->name; }, $terms));
    }
}
