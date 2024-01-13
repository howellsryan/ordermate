namespace ordermateAPI.Models;

public class CategoryModel
{
    public int CategoryId { get; set; }
    public int StoreId { get; set; }
    public string Name { get; set; }
    public string Description { get; set; }
    public string Image { get; set; }
    
    public List<ProductModel> Products { get; set; }
    
    public DateTime CreatedDate { get; set; }
    public DateTime LastModifiedDate { get; set; }
}