namespace ordermateAPI.DAL.Models;

public class ProductOptionModel
{
    public int ProductOptionId { get; set; }
    public int ProductId { get; set; }
    public string Name { get; set; }
    public decimal Price { get; set; }
    public int Quantity { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime LastModifiedDate { get; set; }
}