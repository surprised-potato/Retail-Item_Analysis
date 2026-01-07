import mysql.connector
import pandas as pd
import os
import json

# --- 1. CONFIGURATION ---
DB_CONFIG = {
    'host': '192.168.0.135',
    'user': 'ospos',
    'password': 'password',
    'database': 'osposrevive'
}

# --- 2. QUERY DEFINITIONS ---
QUERIES = {
    "sales_data": """
        SELECT 
            YEAR(s.sale_time) AS sale_year, 
            i.item_number AS barcode, 
            i.name AS item_name, 
            i.category,
            SUM(si.item_unit_price * si.quantity_purchased) AS revenue, 
            SUM((si.item_unit_price - si.item_cost_price) * si.quantity_purchased) AS profit
        FROM ospos_sales s
        JOIN ospos_sales_items si ON s.sale_id = si.sale_id
        JOIN ospos_items i ON si.item_id = i.item_id
        WHERE i.deleted = 0
        GROUP BY sale_year, i.item_id
        ORDER BY sale_year DESC, profit DESC;
    """,
    "seasonality_velocity": """
        SELECT 
            YEAR(s.sale_time) AS sale_year, 
            MONTH(s.sale_time) AS sale_month,
            i.category, 
            SUM(si.item_unit_price * si.quantity_purchased) AS revenue, 
            SUM((si.item_unit_price - si.item_cost_price) * si.quantity_purchased) AS profit
        FROM ospos_sales s
        JOIN ospos_sales_items si ON s.sale_id = si.sale_id
        JOIN ospos_items i ON si.item_id = i.item_id
        WHERE i.deleted = 0
        GROUP BY sale_year, sale_month, i.category
        ORDER BY sale_year DESC, sale_month ASC;
    """,
    "market_basket_analysis": """
        SELECT 
            i1.category AS category_a, 
            i2.category AS category_b, 
            COUNT(DISTINCT s1.sale_id) AS attachment_count
        FROM ospos_sales_items s1
        JOIN ospos_sales_items s2 ON s1.sale_id = s2.sale_id AND s1.item_id < s2.item_id
        JOIN ospos_items i1 ON s1.item_id = i1.item_id
        JOIN ospos_items i2 ON s2.item_id = i2.item_id
        WHERE i1.deleted = 0 
          AND i2.deleted = 0
          AND i1.category != i2.category
        GROUP BY category_a, category_b
        ORDER BY attachment_count DESC
        LIMIT 500;
    """
}

def export_ospos_data():
    try:
        # Establish Connection
        print(f"Connecting to {DB_CONFIG['database']} at {DB_CONFIG['host']}...")
        conn = mysql.connector.connect(**DB_CONFIG)
        
        # Create exports directory if it doesn't exist
        if not os.path.exists('exports'):
            os.makedirs('exports')

        # Run Queries
        data_bundle = {}
        for report_name, sql in QUERIES.items():
            print(f"Generating {report_name}...")
            chunks = []
            for chunk in pd.read_sql(sql, conn, chunksize=1000):
                chunks.append(chunk)
            
            if chunks:
                df = pd.concat(chunks)
                data_bundle[report_name] = df.to_dict(orient='records')
                print(f"✅ Fetched {len(df)} rows for {report_name}")
            else:
                data_bundle[report_name] = []

        # Export to JS
        js_path = 'exports/ospos_data.js'
        with open(js_path, 'w') as f:
            f.write(f"const OSPOS_DATA_BUNDLE = {json.dumps(data_bundle, default=str)};")
        
        print(f"\nAll reports exported successfully to {js_path}")
        
    except mysql.connector.Error as err:
        print(f"❌ Database Error: {err}")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        if 'conn' in locals() and conn.is_connected():
            conn.close()
            print("Connection closed.")

if __name__ == "__main__":
    export_ospos_data()