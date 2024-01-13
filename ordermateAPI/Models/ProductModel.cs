namespace ordermateAPI.Models;

public class ProductModel
{
    public int ProductId { get; set; }
    public int StoreId { get; set; }
    public int CategoryId { get; set; }
    public string Name { get; set; }
    public string Description { get; set; }
    public string Image { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime LastModifiedDate { get; set; }
}